/**
 * Novamail - mail service.
 *
 * The application service layer for everything a user does with a message:
 * flagging, moving, archiving, deleting, snoozing, sending, composing replies,
 * reading bodies and fetching attachments. Every server-side operation is
 * journaled in the sync queue first, so nothing is lost when offline.
 */
import fs from 'node:fs'
import type {
  ComposePayload,
  Id,
  MailAddress,
  MessageDetail,
  MessageSummary,
  OutboxItem,
  SendResult
} from '@shared/types'
import type { AccountsRepository } from '../db/repositories/accounts'
import type { FoldersRepository } from '../db/repositories/folders'
import type { MessagesRepository } from '../db/repositories/messages'
import type { AttachmentsRepository } from '../db/repositories/attachments'
import { ComposeRepository, outboxDedupeKey } from '../db/repositories/compose'
import type { ContactsRepository } from '../db/repositories/productivity'
import type { SyncQueueRepository } from '../db/repositories/rules'
import type { KvRepository } from '../db/repositories/rules'
import type { SettingsService } from '../settings'
import type { SessionManager } from './sessions'
import type { AttachmentService } from '../attachments/service'
import { parseRawMessage, makeSnippet } from './parse'
import { sanitizeEmailHtml, wrapEmailHtml } from './sanitize'
import { SmtpError, classifySmtpError, compileMessage, createTransport, formatAddressList, sendRaw } from './smtp'
import { classifyFocus } from './focus'
import { appEvents } from '../../util/events'
import { createLogger } from '../../util/logger'
import { newId, nowIso, threadKeyFor } from '../../util/ids'
import { fetchRemoteImages } from './remoteContent'
import { safeFilename } from '@shared/attachments'

const log = createLogger('mail')

export interface MailServiceDeps {
  accounts: AccountsRepository
  folders: FoldersRepository
  messages: MessagesRepository
  attachmentsRepo: AttachmentsRepository
  compose: ComposeRepository
  contacts: ContactsRepository
  queue: SyncQueueRepository
  kv: KvRepository
  settings: SettingsService
  sessions: SessionManager
  attachments: AttachmentService
}

interface FlagQueuePayload {
  folderPath: string
  uids: number[]
  flag: string
  add: boolean
}

interface MoveQueuePayload {
  folderPath: string
  uids: number[]
  targetPath: string
  deleteAfter?: boolean
}

export class MailService {
  private sending = false
  private outboxTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: MailServiceDeps) {}

  /* --------------------------------------------------------- read helpers */

  list(query: Parameters<MessagesRepository['list']>[0]): ReturnType<MessagesRepository['list']> {
    return this.deps.messages.list(query)
  }

  async getDetail(id: Id, options: { allowRemoteImages?: boolean } = {}): Promise<MessageDetail | null> {
    let detail = this.deps.messages.get(id)
    if (!detail) return null

    if (!detail.html && !detail.text && !detail.isDraft) {
      const hydrated = await this.ensureBody(id)
      if (hydrated) detail = this.deps.messages.get(id)
    }
    if (!detail) return null

    const cidMap: Record<string, string> = {}
    for (const attachment of detail.attachments) {
      if (attachment.contentId) {
        cidMap[attachment.contentId] = `novamail-att://attachment/${attachment.id}`
      }
    }

    const settings = this.deps.settings.get()
    const allowRemote = options.allowRemoteImages ?? false
    const sanitized = sanitizeEmailHtml(detail.html, { allowRemoteImages: allowRemote, cidMap })
    void settings

    return {
      ...detail,
      html: sanitized.html || (detail.text ? `<pre>${escapeHtml(detail.text)}</pre>` : ''),
      blockedRemoteContentCount: sanitized.blockedRemoteCount
    }
  }

  /** Renders the message for display with the user's theme (used by the reader). */
  renderHtml(detail: MessageDetail): string {
    const settings = this.deps.settings.get()
    return wrapEmailHtml(detail.html ?? '', {
      dark: settings.ui.theme === 'dark',
      textScale: settings.ui.textScale,
      accent: settings.ui.accent
    })
  }

  /** Fetches the body on demand and stores it. */
  async ensureBody(id: Id): Promise<boolean> {
    const summary = this.deps.messages.get(id)
    if (!summary) return false
    if (summary.html || summary.text) return true
    const folder = this.deps.folders.get(summary.folderId)
    if (!folder) return false
    const row = this.deps.sessions.peek(summary.accountId)
    void row
    try {
      const parsed = await this.deps.sessions.withSession(summary.accountId, async (session) => {
        const { source } = await session.downloadMessage(folder.path, this.deps.messages.uid(summary.id))
        return parseRawMessage(source)
      })

      this.deps.messages.saveBody(id, {
        html: parsed.html,
        text: parsed.text,
        blockedRemoteCount: 0,
        headers: parsed.headers
      })

      // Refresh attachment metadata from the real MIME part list.
      const existing = this.deps.attachmentsRepo.listForMessage(id)
      if (existing.length === 0 && parsed.attachments.length > 0) {
        this.deps.messages.upsert({
          accountId: summary.accountId,
          folderId: summary.folderId,
          uid: this.deps.messages.uid(summary.id),
          messageId: parsed.messageId,
          subject: parsed.subject,
          from: parsed.from,
          to: parsed.to,
          cc: parsed.cc,
          bcc: parsed.bcc,
          replyTo: parsed.replyTo,
          date: parsed.date,
          size: summary.size,
          snippet: makeSnippet(parsed.text, parsed.html),
          isRead: true,
          isStarred: summary.isStarred,
          hasAttachments: true,
          attachmentCount: parsed.attachments.length,
          html: parsed.html,
          text: parsed.text,
          attachmentRecords: parsed.attachments.map((attachment) => ({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
            contentId: attachment.contentId,
            disposition: attachment.disposition,
            kind: attachment.kind
          }))
        })
        // Eagerly cache small attachments so previews open instantly.
        for (const attachment of parsed.attachments) {
          if (attachment.size > 12 * 1024 * 1024) continue
          const records = this.deps.attachmentsRepo.listForMessage(id)
          const match = records.find(
            (record) =>
              record.filename === attachment.filename &&
              (record.contentId ?? '') === (attachment.contentId ?? '')
          )
          if (!match) continue
          try {
            const target = this.deps.attachments.cachePathFor(
              summary.accountId,
              id,
              match.id,
              safeFilename(attachment.filename)
            )
            const written = this.deps.attachments.writeCache(target, attachment.content)
            this.deps.attachmentsRepo.markCached(match.id, written.path, written.checksum)
          } catch (error) {
            log.warn('could not warm attachment cache', { error })
          }
        }
      }
      return true
    } catch (error) {
      log.warn('body download failed', { error })
      return false
    }
  }

  /* ------------------------------------------------------- message actions */

  private queueFlags(ids: Id[], flag: string, add: boolean): void {
    const grouped = new Map<string, { accountId: Id; payload: FlagQueuePayload }>()
    for (const id of ids) {
      const message = this.deps.messages.get(id)
      if (!message) continue
      const folder = this.deps.folders.get(message.folderId)
      const uid = this.messageUid(id)
      if (!folder || uid <= 0) continue // locally created rows have no server counterpart
      const key = `${message.accountId}|${folder.path}|${flag}|${add}`
      const entry = grouped.get(key) ?? {
        accountId: message.accountId,
        payload: { folderPath: folder.path, uids: [], flag, add }
      }
      entry.payload.uids.push(uid)
      grouped.set(key, entry)
    }
    for (const [, entry] of grouped) {
      this.deps.queue.enqueue(entry.accountId, 'flags', entry.payload as unknown as Record<string, unknown>)
    }
  }

  private queueMove(ids: Id[], folderKindTarget: string, accountTarget?: Id): void {
    for (const id of ids) {
      const message = this.deps.messages.get(id)
      if (!message) continue
      const folder = this.deps.folders.get(message.folderId)
      const uid = this.messageUid(id)
      if (!folder || uid <= 0) continue
      const targetAccount = accountTarget ?? message.accountId
      this.deps.queue.enqueue(
        message.accountId,
        'move',
        {
          folderPath: folder.path,
          uids: [uid],
          targetPath: folderKindTarget
        } satisfies MoveQueuePayload as unknown as Record<string, unknown>,
        `move:${accountTarget ?? message.accountId}:${folder.path}:${uid}`
      )
    }
  }

  messageUid(id: Id): number {
    return this.deps.messages.uid(id)
  }

  setFlag(ids: Id[], field: 'isRead' | 'isStarred' | 'isImportant', value: boolean): void {
    this.deps.messages.setFlags(ids, field, value)
    if (field === 'isRead') this.queueFlags(ids, '\\Seen', value)
    if (field === 'isStarred') this.queueFlags(ids, '\\Flagged', value)
    this.notifyMailboxChange()
  }

  archive(ids: Id[]): void {
    const moves: { id: Id; targetFolderId: Id }[] = []
    for (const id of ids) {
      const message = this.deps.messages.get(id)
      if (!message) continue
      const archiveFolder =
        this.deps.folders.findByKind(message.accountId, 'archive') ??
        this.deps.folders.createLocal(message.accountId, 'Archive')
      moves.push({ id, targetFolderId: archiveFolder.id })
      this.queueMove([id], archiveFolder.path)
    }
    for (const move of moves) this.deps.messages.move([move.id], move.targetFolderId)
    this.notifyMailboxChange()
  }

  trash(ids: Id[]): void {
    for (const id of ids) {
      const message = this.deps.messages.get(id)
      if (!message) continue
      const trashFolder =
        this.deps.folders.findByKind(message.accountId, 'trash') ??
        this.deps.folders.createLocal(message.accountId, 'Trash')
      this.queueMove([id], trashFolder.path)
      this.deps.messages.move([id], trashFolder.id)
      this.deps.messages.unsnooze([id])
    }
    this.notifyMailboxChange()
  }

  restore(ids: Id[]): void {
    for (const id of ids) {
      const message = this.deps.messages.get(id)
      if (!message) continue
      const inbox = this.deps.folders.findByKind(message.accountId, 'inbox')
      if (!inbox) continue
      this.queueMove([id], inbox.path)
      this.deps.messages.move([id], inbox.id)
    }
    this.notifyMailboxChange()
  }

  move(ids: Id[], folderId: Id): void {
    const target = this.deps.folders.get(folderId)
    if (!target) throw new Error('Target folder not found')
    for (const id of ids) {
      const message = this.deps.messages.get(id)
      if (!message) continue
      if (message.accountId !== target.accountId) continue
      this.queueMove([id], target.path)
    }
    this.deps.messages.move(ids, folderId)
    this.notifyMailboxChange()
  }

  /** Deletes permanently (no trash step). Used from the Trash folder only. */
  async deletePermanently(ids: Id[]): Promise<void> {
    for (const id of ids) {
      const message = this.deps.messages.get(id)
      if (!message) continue
      const folder = this.deps.folders.get(message.folderId)
      const uid = this.messageUid(id)
      if (folder && uid > 0) {
        this.deps.queue.enqueue(message.accountId, 'delete', {
          folderPath: folder.path,
          uids: [uid]
        } satisfies Partial<MoveQueuePayload> as unknown as Record<string, unknown>)
      }
    }
    this.deps.messages.remove(ids)
    this.notifyMailboxChange()
  }

  snooze(ids: Id[], until: string): void {
    if (Number.isNaN(Date.parse(until))) throw new Error('Invalid snooze date')
    this.deps.messages.snooze(ids, until)
    this.deps.messages.setFlags(ids, 'isRead', true)
    this.notifyMailboxChange()
  }

  unsnooze(ids: Id[]): void {
    this.deps.messages.unsnooze(ids)
    this.notifyMailboxChange()
  }

  addLabel(ids: Id[], label: string): void {
    this.deps.messages.addLabel(ids, label)
    this.deps.kv.set(`label:${label}`, { name: label, createdAt: nowIso() })
    this.notifyMailboxChange()
  }

  removeLabel(ids: Id[], label: string): void {
    this.deps.messages.removeLabel(ids, label)
    this.notifyMailboxChange()
  }

  markFolderRead(folderId: Id): void {
    this.deps.messages.markFolderRead(folderId)
    const messages = this.deps.messages.list({ mailbox: `folder:${folderId}`, limit: 200, unreadOnly: true })
    this.queueFlags(
      messages.items.map((m) => m.id),
      '\\Seen',
      true
    )
    this.notifyMailboxChange()
  }

  async thread(threadId: string): Promise<MessageSummary[]> {
    return this.deps.messages.thread(threadId)
  }

  /* ------------------------------------------------------- remote content */

  async showRemoteImages(messageId: Id): Promise<{ html: string; loaded: number; failed: number }> {
    const detail = this.deps.messages.get(messageId)
    if (!detail?.html) return { html: '', loaded: 0, failed: 0 }
    const result = await fetchRemoteImages(detail.html, { maxImages: 30 })
    const settings = this.deps.settings.get()
    const final = sanitizeEmailHtml(result.html, { allowRemoteImages: true })
    return {
      html: wrapEmailHtml(final.html, {
        dark: settings.ui.theme === 'dark',
        textScale: settings.ui.textScale,
        accent: settings.ui.accent
      }),
      loaded: result.loaded,
      failed: result.failed
    }
  }

  /* ----------------------------------------------------------- composing */

  saveDraft(payload: ComposePayload): Id {
    const account = this.deps.accounts.get(payload.accountId)
    if (!account) throw new Error('Choose an account before saving a draft.')
    const draftsFolder =
      this.deps.folders.findByKind(account.id, 'drafts') ?? this.deps.folders.createLocal(account.id, 'Drafts')

    const draftId = payload.draftId ?? newId()
    this.deps.compose.saveDraft({ ...payload, draftId })

    const snippet = makeSnippet(payload.text, payload.html)
    const existingRow = this.deps.messages.get(draftId)
    if (existingRow) {
      this.deps.messages.upsert({
        accountId: account.id,
        folderId: draftsFolder.id,
        uid: this.deps.messages.uid(draftId),
        messageId: null,
        subject: payload.subject || '(no subject)',
        from: { name: account.displayName, address: account.email },
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        date: nowIso(),
        size: Buffer.byteLength(payload.html ?? ''),
        snippet,
        isRead: true,
        isStarred: false,
        isDraft: true,
        hasAttachments: payload.attachments.length > 0,
        attachmentCount: payload.attachments.length,
        html: payload.html,
        text: payload.text
      })
    } else {
      this.deps.messages.upsert({
        id: draftId,
        accountId: account.id,
        folderId: draftsFolder.id,
        uid: this.deps.messages.localUid(),
        messageId: null,
        subject: payload.subject || '(no subject)',
        from: { name: account.displayName, address: account.email },
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        date: nowIso(),
        size: Buffer.byteLength(payload.html ?? ''),
        snippet,
        isRead: true,
        isStarred: false,
        isDraft: true,
        hasAttachments: payload.attachments.length > 0,
        attachmentCount: payload.attachments.length,
        html: payload.html,
        text: payload.text,
        threadId: `draft:${draftId}`
      })
    }
    this.notifyMailboxChange()
    return draftId
  }

  discardDraft(draftId: Id): void {
    this.deps.compose.deleteDraft(draftId)
    this.deps.messages.remove([draftId])
    this.notifyMailboxChange()
  }

  async send(payload: ComposePayload): Promise<SendResult> {
    const account = this.deps.accounts.get(payload.accountId)
    if (!account) return { ok: false, error: 'Choose an account before sending.' }
    if (payload.to.length === 0 && payload.cc.length === 0 && payload.bcc.length === 0) {
      return { ok: false, error: 'Add at least one recipient.' }
    }
    const settings = this.deps.settings.get()
    const scheduledAt = payload.scheduledAt ?? null
    const undoSend = !scheduledAt ? settings.compose.undoSendSeconds : 0
    const sendAt = scheduledAt ?? new Date(Date.now() + undoSend * 1000).toISOString()

    // Reject missing attachment files before queueing.
    for (const attachment of payload.attachments) {
      if (!attachment.path || !fs.existsSync(attachment.path)) {
        return { ok: false, error: `The attachment "${attachment.name}" is missing. Re-attach it and try again.` }
      }
    }

    const item = this.deps.compose.enqueue(
      { ...payload, scheduledAt: sendAt },
      { scheduledAt: sendAt, dedupeKey: outboxDedupeKey({ ...payload, scheduledAt: sendAt }) }
    )

    if (payload.draftId) {
      this.deps.compose.deleteDraft(payload.draftId)
      this.deps.messages.remove([payload.draftId])
    }

    appEvents.emit('outbox:changed', this.deps.compose.listOutbox())
    this.notifyMailboxChange()

    if (!scheduledAt && undoSend === 0) {
      void this.processOutbox()
    } else {
      this.scheduleOutboxProcessing()
    }

    return { ok: true, outboxId: item.id, scheduledFor: sendAt }
  }

  listOutbox(): OutboxItem[] {
    return this.deps.compose.listOutbox()
  }

  cancelOutbox(id: Id): void {
    const item = this.deps.compose.getOutbox(id)
    if (!item) return
    if (item.status === 'queued') {
      this.deps.compose.cancel(id)
      appEvents.emit('outbox:changed', this.deps.compose.listOutbox())
      appEvents.emit('toast', {
        id: newId(),
        tone: 'info',
        title: 'Sending cancelled',
        description: 'The message was not sent. It is still available in your drafts.'
      })
    }
  }

  retryOutbox(id: Id): void {
    this.deps.compose.requeue(id)
    void this.processOutbox()
  }

  sendOutboxNow(id: Id): void {
    this.deps.compose.makeDueNow(id)
    void this.processOutbox()
  }

  scheduleOutboxProcessing(): void {
    if (this.outboxTimer) clearTimeout(this.outboxTimer)
    this.outboxTimer = setTimeout(() => {
      this.outboxTimer = null
      void this.processOutbox()
    }, 1500)
  }

  /** Sends all due outbox rows. Guarded so the same row can never send twice. */
  async processOutbox(): Promise<void> {
    if (this.sending) return
    this.sending = true
    try {
      const due = this.deps.compose.dueOutbox()
      for (const item of due) {
        const current = this.deps.compose.getOutbox(item.id)
        if (!current || current.status !== 'queued') continue
        this.deps.compose.markSending(item.id)
        try {
          await this.deliver(item.payload)
          this.deps.compose.markSent(item.id)
          log.info('message sent')
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.deps.compose.markFailed(item.id, message)
          log.warn('send failed', { error })
          appEvents.emit('toast', {
            id: newId(),
            tone: 'error',
            title: 'Sending failed',
            description: `${message} The message stays in the Outbox and can be retried.`
          })
        }
      }
      appEvents.emit('outbox:changed', this.deps.compose.listOutbox())
      this.notifyMailboxChange()
    } finally {
      this.sending = false
    }
    // scheduled items in the future need a timer
    const pending = this.deps.compose
      .listOutbox()
      .filter((item) => item.status === 'queued' && item.scheduledAt && Date.parse(item.scheduledAt) > Date.now())
    if (pending.length > 0) {
      const earliest = Math.min(...pending.map((item) => Date.parse(item.scheduledAt!)))
      const delay = Math.min(Math.max(earliest - Date.now(), 500), 60_000)
      if (this.outboxTimer) clearTimeout(this.outboxTimer)
      this.outboxTimer = setTimeout(() => {
        this.outboxTimer = null
        void this.processOutbox()
      }, delay)
    }
  }

  private async deliver(payload: ComposePayload): Promise<void> {
    const account = this.deps.accounts.get(payload.accountId)
    if (!account) throw new SmtpError('The account for this message no longer exists.', 'server')
    const auth = await this.deps.sessions.resolveAuth(account)
    const smtpAuth =
      auth.kind === 'password'
        ? { kind: 'password' as const, user: auth.user, pass: auth.pass }
        : { kind: 'oauth2' as const, user: auth.user, accessToken: auth.accessToken }

    const raw = await compileMessage({
      payload,
      from: { name: account.displayName, address: account.email },
      messageIdDomain: account.email.split('@')[1] ?? 'novamail.local'
    })

    const transporter = createTransport(account.smtp, smtpAuth)
    try {
      const result = await sendRaw(transporter, {
        raw,
        from: account.email,
        to: [...payload.to, ...payload.cc, ...payload.bcc].map((address) => address.address)
      })

      // Append the identical MIME source to the Sent folder.
      const sentFolder =
        this.deps.folders.findByKind(account.id, 'sent') ?? this.deps.folders.createLocal(account.id, 'Sent')
      try {
        await this.deps.sessions.withSession(account.id, async (session) => {
          await session.appendMessage(sentFolder.path, result.raw, ['\\Seen'])
        })
      } catch (error) {
        log.warn('sent copy could not be appended to the server', { error })
      }

      this.insertSentCopy(payload, account.email, account.displayName, sentFolder.id, account.id)

      // Learn recipients for autocomplete.
      this.deps.contacts.recordUsage(payload.to)
    } catch (error) {
      throw classifySmtpError(error)
    } finally {
      transporter.close()
    }
  }

  private insertSentCopy(
    payload: ComposePayload,
    accountEmail: string,
    displayName: string,
    sentFolderId: Id,
    accountId: Id
  ): void {
    const id = newId()
    const uid = this.deps.messages.localUid()
    const date = nowIso()
    this.deps.messages.upsert({
      accountId,
      folderId: sentFolderId,
      uid,
      messageId: `<sent-${id}@novamail.local>`,
      subject: payload.subject || '(no subject)',
      from: { name: displayName, address: accountEmail },
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      date,
      size: Buffer.byteLength(payload.html ?? ''),
      snippet: makeSnippet(payload.text, payload.html),
      isRead: true,
      isStarred: false,
      hasAttachments: payload.attachments.length > 0,
      attachmentCount: payload.attachments.length,
      html: payload.html,
      text: payload.text,
      isFocused: true,
      threadId: threadKeyFor(null, payload.references, payload.subject)
    })
    for (const attachment of payload.attachments) {
      this.deps.attachmentsRepo.add({
        messageId: id,
        filename: attachment.name,
        mimeType: attachment.mimeType || 'application/octet-stream',
        size: attachment.size,
        contentId: attachment.contentId ?? null,
        disposition: attachment.isInline ? 'inline' : 'attachment',
        kind: 'unknown'
      })
    }
  }

  /** Builds the reply / reply-all / forward skeleton. */
  async buildReply(messageId: Id, mode: 'reply' | 'replyAll' | 'forward' | 'redirect'): Promise<ComposePayload> {
    const detail = await this.getDetail(messageId)
    if (!detail) throw new Error('The original message could not be loaded.')
    const account = this.deps.accounts.get(detail.accountId)
    if (!account) throw new Error('Account not found')

    const self = account.email.toLowerCase()
    const quoteHeader = `\n\n<div style="border-left:3px solid #b9c8d1;padding-left:12px;margin:12px 0;color:#5c6b78">
      <div><strong>From:</strong> ${escapeHtml(detail.from.name || detail.from.address)} &lt;${escapeHtml(detail.from.address)}&gt;</div>
      <div><strong>Sent:</strong> ${escapeHtml(new Date(detail.date).toLocaleString())}</div>
      <div><strong>To:</strong> ${escapeHtml(detail.to.map((t) => t.address).join(', '))}</div>
      <div><strong>Subject:</strong> ${escapeHtml(detail.subject)}</div>
    </div>\n`

    const prefix = mode === 'forward' ? 'Fwd' : 'Re'
    const subject = /^(re|fwd|aw|sv):/i.test(detail.subject) ? detail.subject : `${prefix}: ${detail.subject}`

    const to: MailAddress[] =
      mode === 'forward' || mode === 'redirect'
        ? []
        : [detail.replyTo[0] ?? detail.from].filter((address) => address.address && address.address.toLowerCase() !== self)
    const cc: MailAddress[] =
      mode === 'replyAll'
        ? [...detail.to, ...detail.cc].filter(
            (address) => address.address.toLowerCase() !== self && !to.some((t) => t.address === address.address)
          )
        : []

    const references = [...detail.references, detail.messageId].filter((v): v is string => Boolean(v))
    const bodyHtml =
      mode === 'forward' || mode === 'redirect'
        ? `${quoteHeader}${detail.html ?? ''}`
        : `${quoteHeader}${detail.html ?? ''}`

    return {
      mode,
      accountId: account.id,
      to,
      cc,
      bcc: [],
      subject,
      html: bodyHtml,
      text: detail.text ?? '',
      attachments:
        mode === 'forward'
          ? detail.attachments.map((attachment) => ({
              // Forwarded attachments are referenced by attachment id and resolved at send time.
              path: `attachment:${attachment.id}`,
              name: attachment.filename,
              size: attachment.size,
              mimeType: attachment.mimeType
            }))
          : [],
      inReplyTo: mode === 'redirect' ? null : detail.messageId,
      references: mode === 'redirect' ? [] : references,
      importance: 'normal',
      requestReadReceipt: false,
      scheduledAt: null,
      draftId: undefined
    }
  }

  private notifyMailboxChange(): void {
    this.deps.folders.refreshCounts()
    appEvents.emit('messages:changed', { reason: 'refresh' })
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
