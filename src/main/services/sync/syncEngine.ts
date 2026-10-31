/**
 * Novamail - synchronisation engine.
 *
 * Responsibilities:
 *  - keep folders and message headers up to date per account
 *  - hydrate bodies so previously synchronised mail can be read offline
 *  - apply rules to new mail
 *  - drain the offline operation queue with retry/backoff
 *  - report precise status to the UI
 *  - run housekeeping (attachment cache retention, snooze wake-ups)
 *
 * The engine never blocks the UI: every account runs independently and failures
 * are isolated per account.
 */
import type { Account, Folder, Id, MessageSummary, SyncStatus } from '@shared/types'
import type { AccountsRepository } from '../db/repositories/accounts'
import type { FoldersRepository } from '../db/repositories/folders'
import type { MessagesRepository } from '../db/repositories/messages'
import type { RulesRepository, SyncQueueRepository, SyncQueueRepository as QueueRepo } from '../db/repositories/rules'
import type { ComposeRepository } from '../db/repositories/compose'
import type { CalendarRepository } from '../db/repositories/productivity'
import type { SettingsService } from '../settings'
import type { SessionManager } from '../mail/sessions'
import type { AttachmentService } from '../attachments/service'
import type { MailService } from '../mail/mailService'
import { ImapSession } from '../mail/imap'
import { parseRawMessage, makeSnippet } from '../mail/parse'
import { classifyFocus } from '../mail/focus'
import { evaluateRules } from '../rules/engine'
import { appEvents } from '../../util/events'
import { createLogger } from '../../util/logger'
import { nowIso, threadKeyFor } from '../../util/ids'

const log = createLogger('sync')

export interface SyncNotifier {
  newMail(account: Account, messages: MessageSummary[]): void
  reminder(title: string, body: string): void
}

export interface SyncEngineDeps {
  accounts: AccountsRepository
  folders: FoldersRepository
  messages: MessagesRepository
  queue: SyncQueueRepository
  compose: ComposeRepository
  rules: RulesRepository
  calendar: CalendarRepository
  settings: SettingsService
  sessions: SessionManager
  attachments: AttachmentService
  mail: MailService
  notifier: SyncNotifier
}

interface AccountRuntime {
  syncing: boolean
  idle: boolean
  progress: { folder: string; current: number; total: number } | null
  error: string | null
  lastRunAt: string | null
  retryTimer: NodeJS.Timeout | null
  idleSession: ImapSession | null
}

const MAX_RETRY_DELAY = 5 * 60_000

export class SyncEngine {
  private timer: NodeJS.Timeout | null = null
  private offline = false
  private running = false
  private readonly runtime = new Map<Id, AccountRuntime>()
  private readonly hydratedFolders = new Set<string>()

  constructor(private readonly deps: SyncEngineDeps) {}

  /* ------------------------------------------------------------- lifecycle */

  start(): void {
    this.scheduleNext(2_000)
    // Startup housekeeping, deliberately delayed so the UI opens first.
    setTimeout(() => {
      void this.housekeeping()
    }, 15_000)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const [, runtime] of this.runtime) {
      if (runtime.retryTimer) clearTimeout(runtime.retryTimer)
      runtime.idleSession?.logout().catch(() => undefined)
    }
  }

  setOffline(offline: boolean): void {
    this.offline = offline
    log.info('offline mode changed', { offline })
    this.emitStatus()
  }

  isOffline(): boolean {
    return this.offline
  }

  private scheduleNext(delayMs?: number): void {
    if (this.timer) clearTimeout(this.timer)
    const interval = this.deps.settings.get().sync.intervalMinutes * 60_000
    this.timer = setTimeout(() => {
      void this.syncAll().finally(() => this.scheduleNext())
    }, delayMs ?? interval)
  }

  /* ----------------------------------------------------------------- status */

  status(): SyncStatus {
    const accounts = this.deps.accounts.list()
    const queueCount = this.deps.queue.pendingCount()
    const accountStatuses = accounts.map((account) => {
      const runtime = this.runtime.get(account.id)
      const hasAuthProblem = account.syncState === 'auth-required'
      return {
        accountId: account.id,
        email: account.email,
        state: runtime?.syncing
          ? ('syncing' as const)
          : hasAuthProblem
            ? ('auth-required' as const)
            : this.offline
              ? ('offline' as const)
              : account.syncState,
        lastSyncAt: account.lastSyncAt,
        progress: runtime?.progress ?? null,
        lastError: runtime?.error ?? account.lastError,
        pendingUploads: this.deps.queue.pendingForAccount(account.id)
      }
    })

    const anySyncing = accountStatuses.some((status) => status.state === 'syncing')
    const anyError = accountStatuses.some((status) => status.state === 'error' || status.state === 'auth-required')

    return {
      globalPhase: this.offline ? 'offline' : anySyncing ? 'syncing' : anyError ? 'error' : 'idle',
      offline: this.offline,
      queuedOperations: queueCount,
      accounts: accountStatuses
    }
  }

  emitStatus(): void {
    appEvents.emit('sync:status', this.status())
  }

  private runtimeFor(accountId: Id): AccountRuntime {
    const existing = this.runtime.get(accountId)
    if (existing) return existing
    const created: AccountRuntime = {
      syncing: false,
      idle: false,
      progress: null,
      error: null,
      lastRunAt: null,
      retryTimer: null,
      idleSession: null
    }
    this.runtime.set(accountId, created)
    return created
  }

  /* --------------------------------------------------------------- syncing */

  async syncAll(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const accounts = this.deps.accounts.list()
      for (const account of accounts) {
        await this.syncAccount(account.id).catch((error) => {
          log.error('account sync failed', { accountId: account.id, error })
        })
      }
      await this.drainQueue()
      await this.wakeSnoozes()
      await this.queueReminders()
    } finally {
      this.running = false
      this.emitStatus()
    }
  }

  async syncAccount(accountId: Id): Promise<void> {
    const account = this.deps.accounts.get(accountId)
    if (!account) return
    if (this.offline) {
      this.emitStatus()
      return
    }
    const runtime = this.runtimeFor(accountId)
    if (runtime.syncing) return
    runtime.syncing = true
    runtime.error = null
    this.deps.accounts.setSyncState(accountId, 'syncing')
    this.emitStatus()

    try {
      await this.deps.sessions.withSession(accountId, async (session, liveAccount) => {
        const remoteFolders = await session.listFolders()
        if (remoteFolders.length === 0) {
          throw new Error('The server did not return any folders.')
        }
        const folderMap = this.deps.folders.syncServerFolders(
          accountId,
          remoteFolders.map((folder) => ({
            path: folder.path,
            name: folder.name,
            delimiter: folder.delimiter,
            parentPath: folder.parentPath,
            kind: folder.kind,
            uidValidity: folder.uidValidity
          }))
        )

        const localFolders = this.deps.folders.list(accountId)
        const relevant = localFolders.filter((folder) => this.shouldSyncFolder(folder))
        let index = 0
        for (const folder of relevant) {
          index += 1
          runtime.progress = { folder: folder.name, current: index, total: relevant.length }
          this.emitStatus()
          try {
            const remote = remoteFolders.find((item) => item.path === folder.path)
            await this.syncFolder(session, liveAccount, folder, remote?.uidValidity ?? null)
          } catch (error) {
            log.warn('folder sync failed', { accountId, folder: folder.path, error })
            runtime.error = error instanceof Error ? error.message : String(error)
          }
        }
        runtime.progress = null
        this.deps.accounts.touchSync(accountId)
        void folderMap
      })

      // Refresh counters and notify the UI.
      this.deps.folders.refreshCounts(accountId)
      appEvents.emit('folders:changed', { accountId })
      appEvents.emit('messages:changed', { accountId, reason: 'refresh' })
      runtime.lastRunAt = nowIso()
      this.startIdleWatcher(accountId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      runtime.error = message
      this.deps.accounts.setSyncState(accountId, 'error', message)
      log.warn('sync failed', { accountId, message })
      this.scheduleRetry(accountId)
    } finally {
      runtime.syncing = false
      this.emitStatus()
    }
  }

  private scheduleRetry(accountId: Id): void {
    const runtime = this.runtimeFor(accountId)
    if (runtime.retryTimer) clearTimeout(runtime.retryTimer)
    runtime.retryTimer = setTimeout(
      () => {
        runtime.retryTimer = null
        void this.syncAccount(accountId)
      },
      Math.min(MAX_RETRY_DELAY, 60_000)
    )
  }

  private shouldSyncFolder(folder: Folder): boolean {
    // Skip Gmail's "[Gmail]/All Mail" duplicate view and virtual folders.
    if (/^\[gmail\]\/all mail$/i.test(folder.path)) return false
    if (folder.kind === 'outbox') return false
    return true
  }

  private async syncFolder(
    session: ImapSession,
    account: Account,
    folder: Folder,
    serverUidValidity: number | null
  ): Promise<void> {
    const state = this.deps.folders.getUidState(folder.id)
    let sinceUid = state.lastSeenUid

    // UIDVALIDITY changed: the server renumbered the mailbox, so drop stale rows.
    if (serverUidValidity !== null && state.uidValidity !== null && serverUidValidity !== state.uidValidity) {
      log.info('uidvalidity changed, rebuilding folder cache', { folder: folder.path })
      this.deps.messages.removeByFolder(folder.id)
      sinceUid = 0
    }
    if (serverUidValidity !== null) {
      this.deps.folders.setUidState(folder.id, serverUidValidity, sinceUid)
    }

    const envelopes = await session.fetchHeaders(folder.path, {
      sinceUid,
      limit: sinceUid === 0 ? 120 : 200
    })

    if (envelopes.length === 0) return

    const newMessages: MessageSummary[] = []
    let maxUid = sinceUid
    const rules = this.deps.rules.list()

    for (const envelope of envelopes) {
      maxUid = Math.max(maxUid, envelope.uid)
      const isRead = envelope.flags.includes('\\Seen')
      const isStarred = envelope.flags.includes('\\Flagged')
      const focus =
        classifyFocus({
          fromAddress: envelope.from.address,
          fromName: envelope.from.name,
          subject: envelope.subject,
          headers: envelope.headers,
          toAddresses: envelope.to.map((t) => t.address),
          accountEmail: account.email
        }) === 'focused'

      const snippet = makeSnippet(null, null, 0)
      const { id, isNew } = this.deps.messages.upsert({
        accountId: account.id,
        folderId: folder.id,
        uid: envelope.uid,
        messageId: envelope.messageId,
        subject: envelope.subject,
        from: envelope.from,
        to: envelope.to,
        cc: envelope.cc,
        replyTo: envelope.replyTo,
        date: envelope.date,
        size: envelope.size,
        snippet: snippet || (envelope.subject ? `${envelope.subject}` : ''),
        isRead,
        isStarred,
        hasAttachments: envelope.hasAttachments,
        attachmentCount: envelope.attachmentCount,
        headers: envelope.headers,
        references: envelope.headers['references']?.split(/\s+/).filter(Boolean) ?? [],
        inReplyTo: envelope.headers['in-reply-to'] ?? null,
        listUnsubscribe: envelope.headers['list-unsubscribe'] ?? null,
        imapFlags: envelope.flags.join(' '),
        isFocused: focus,
        threadId: threadKeyFor(
          envelope.messageId,
          envelope.headers['references']?.split(/\s+/).filter(Boolean) ?? [],
          envelope.subject
        ),
        attachmentRecords: envelope.structure.map((structure) => ({
          filename: structure.filename,
          mimeType: structure.mimeType,
          size: structure.size,
          contentId: structure.contentId,
          disposition: structure.disposition,
          kind: 'unknown'
        }))
      })

      if (isNew && folder.kind === 'inbox' && !isRead) {
        const summary = this.deps.messages.get(id)
        if (summary) newMessages.push(summary)
      }
      if (isNew && rules.length > 0) {
        this.applyRules(id, account, envelope.subject, envelope.from.address, envelope.from.name, envelope.to.map((t) => t.address), envelope.hasAttachments)
      }
    }

    this.deps.folders.setUidState(folder.id, serverUidValidity ?? state.uidValidity, maxUid)
    await this.hydrateBodies(session, folder, sinceUid === 0 ? 15 : 40)

    if (newMessages.length > 0) {
      this.deps.folders.refreshCounts(account.id)
      this.deps.notifier.newMail(account, newMessages)
      appEvents.emit('messages:changed', { accountId: account.id, folderId: folder.id, reason: 'new' })
    }
  }

  private applyRules(
    messageId: Id,
    account: Account,
    subject: string,
    fromAddress: string,
    fromName: string,
    toAddresses: string[],
    hasAttachment: boolean
  ): void {
    const rules = this.deps.rules.list()
    if (rules.length === 0) return
    const evaluation = evaluateRules(rules, {
      accountId: account.id,
      accountEmail: account.email,
      fromAddress,
      fromName,
      toAddresses,
      subject,
      body: '',
      hasAttachment
    })
    if (evaluation.matched.length === 0) return

    for (const action of evaluation.actions) {
      switch (action.type) {
        case 'markRead':
          this.deps.messages.setFlags([messageId], 'isRead', true)
          break
        case 'star':
          this.deps.messages.setFlags([messageId], 'isStarred', true)
          break
        case 'label':
          this.deps.messages.addLabel([messageId], action.value)
          break
        case 'move': {
          const target =
            this.deps.folders.findByPath(account.id, action.value) ??
            this.deps.folders.list(account.id).find((folder) => folder.name.toLowerCase() === action.value.toLowerCase())
          if (target) this.deps.mail.move([messageId], target.id)
          break
        }
        case 'delete':
          this.deps.mail.trash([messageId])
          break
        case 'forward':
          log.info('rule forward action skipped: needs the full message body', { messageId })
          break
        default:
          break
      }
    }
    for (const rule of evaluation.matched) this.deps.rules.bumpMatchCount(rule.id, 1)
  }

  /** Downloads bodies for the newest messages so they can be read offline. */
  private async hydrateBodies(session: ImapSession, folder: Folder, limit: number): Promise<void> {
    const key = `${folder.id}`
    if (this.hydratedFolders.has(key)) return
    this.hydratedFolders.add(key)
    const pending = this.deps.messages.pendingBodyIds(folder.id, limit)
    for (const item of pending) {
      try {
        const { source } = await session.downloadMessage(folder.path, item.uid)
        const parsed = await parseRawMessage(source)
        this.deps.messages.saveBody(item.id, {
          html: parsed.html,
          text: parsed.text,
          blockedRemoteCount: parsed.hasRemoteContent ? 1 : 0,
          headers: parsed.headers
        })
        const snippet = makeSnippet(parsed.text, parsed.html)
        this.deps.messages.upsert({
          accountId: folder.accountId,
          folderId: folder.id,
          uid: item.uid,
          messageId: parsed.messageId,
          subject: parsed.subject,
          from: parsed.from,
          to: parsed.to,
          cc: parsed.cc,
          bcc: parsed.bcc,
          replyTo: parsed.replyTo,
          date: parsed.date,
          size: source.length,
          snippet,
          isRead: true,
          isStarred: false,
          hasAttachments: parsed.attachments.length > 0,
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
      } catch (error) {
        log.debug('body hydration skipped one message', { error })
      }
    }
    // allow a later pass to hydrate more
    setTimeout(() => this.hydratedFolders.delete(key), 10 * 60_000)
  }

  /* ------------------------------------------------------- queued operations */

  async drainQueue(): Promise<number> {
    if (this.offline) return 0
    let processed = 0
    const due = this.deps.queue.due(25)
    for (const item of due) {
      const account = this.deps.accounts.get(item.accountId)
      if (!account) {
        this.deps.queue.complete(item.id)
        continue
      }
      try {
        await this.deps.sessions.withSession(item.accountId, async (session) => {
          switch (item.opType) {
            case 'flags': {
              const payload = item.payload as { folderPath: string; uids: number[]; flag: string; add: boolean }
              await session.setFlags(payload.folderPath, payload.uids, [payload.flag], payload.add)
              break
            }
            case 'move': {
              const payload = item.payload as { folderPath: string; uids: number[]; targetPath: string }
              await session.moveMessages(payload.folderPath, payload.uids, payload.targetPath)
              break
            }
            case 'delete': {
              const payload = item.payload as { folderPath: string; uids: number[] }
              await session.deleteMessages(payload.folderPath, payload.uids)
              break
            }
            default:
              log.warn('unknown queue operation', { opType: item.opType })
          }
        })
        this.deps.queue.complete(item.id)
        processed += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const backoff = Math.min(MAX_RETRY_DELAY, 15_000 * 2 ** item.attempts)
        this.deps.queue.fail(item.id, message, backoff)
        log.warn('queued operation failed', { opType: item.opType, attempts: item.attempts })
      }
    }
    if (processed > 0) {
      this.emitStatus()
      appEvents.emit('messages:changed', { reason: 'refresh' })
    }
    return processed
  }

  /* ----------------------------------------------------------- housekeeping */

  private async wakeSnoozes(): Promise<void> {
    const due = this.deps.messages.dueSnoozes()
    if (due.length === 0) return
    appEvents.emit('messages:changed', { reason: 'refresh' })
    for (const message of due) {
      this.deps.notifier.reminder('Snoozed mail is back', message.subject)
    }
    log.info('snoozed mail returned to the inbox', { count: due.length })
  }

  private async queueReminders(): Promise<void> {
    const events = this.deps.calendar.upcoming(15)
    for (const event of events) {
      if (event.reminderMinutes === null) continue
      const start = Date.parse(event.start)
      const remindAt = start - event.reminderMinutes * 60_000
      if (Math.abs(Date.now() - remindAt) < 60_000) {
        this.deps.notifier.reminder(event.title, `Starts at ${new Date(event.start).toLocaleTimeString()}`)
      }
    }
  }

  async housekeeping(): Promise<void> {
    try {
      const settings = this.deps.settings.get()
      this.deps.attachments.prune()
      this.deps.compose.pruneSentOlderThan(30)
      this.deps.queue.pruneFinished(7)
      this.deps.attachments.stats()
      log.debug('housekeeping finished', { retentionDays: settings.privacy.autoDeleteTempFilesDays })
    } catch (error) {
      log.warn('housekeeping failed', { error })
    }
  }

  /* -------------------------------------------------------------- IDLE watch */

  private startIdleWatcher(accountId: Id): void {
    const settings = this.deps.settings.get()
    if (!settings.sync.useIdle) return
    const account = this.deps.accounts.get(accountId)
    if (!account || !account.capabilities.idle) return
    const runtime = this.runtimeFor(accountId)
    if (runtime.idle) return
    runtime.idle = true
    void this.idleLoop(accountId)
  }

  private async idleLoop(accountId: Id): Promise<void> {
    const runtime = this.runtimeFor(accountId)
    while (runtime.idle) {
      try {
        const account = this.deps.accounts.get(accountId)
        if (!account) break
        if (!runtime.idleSession) {
          const auth = await this.deps.sessions.resolveAuth(account)
          const session = new ImapSession({ server: account.imap, auth })
          await session.connect()
          runtime.idleSession = session
        }
        const gotNew = await runtime.idleSession.waitForNewMail(4 * 60_000)
        if (gotNew) {
          log.info('idle reported new mail', { accountId })
          await this.syncAccount(accountId)
        }
      } catch (error) {
        log.warn('idle watcher restarting', { accountId, error })
        await runtime.idleSession?.logout().catch(() => undefined)
        runtime.idleSession = null
        await new Promise((resolve) => setTimeout(resolve, 60_000))
      }
    }
    await runtime.idleSession?.logout().catch(() => undefined)
    runtime.idleSession = null
  }

  stopIdle(accountId: Id): void {
    const runtime = this.runtime.get(accountId)
    if (!runtime) return
    runtime.idle = false
    void runtime.idleSession?.logout().catch(() => undefined)
    runtime.idleSession = null
  }
}

export type { QueueRepo }
