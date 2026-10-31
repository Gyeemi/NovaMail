/**
 * Novamail - message repository.
 *
 * The single place that knows how to read and write mail rows. Every write that
 * affects the server is mirrored into the sync queue by the mail service, not
 * here (keep repositories free of network concerns).
 */
import type {
  FolderKind,
  Id,
  MailAddress,
  MessageDetail,
  MessageListQuery,
  MessageListResult,
  MessageSummary
} from '@shared/types'
import type { Db } from '../database'
import { newId, nowIso, threadKeyFor } from '../../../util/ids'
import { buildFtsMatch } from '../../search/parse'

export interface MessageRow {
  id: string
  account_id: string
  account_email?: string
  folder_id: string
  folder_kind?: string
  folder_name?: string
  uid: number
  message_id: string | null
  thread_id: string
  subject: string
  from_name: string
  from_address: string
  to_json: string
  cc_json: string
  bcc_json: string
  reply_to_json: string
  snippet: string
  date: string
  size: number
  is_read: number
  is_starred: number
  is_important: number
  is_draft: number
  is_snoozed: number
  snooze_until: string | null
  has_attachments: number
  attachment_count: number
  blocked_remote_count: number
  labels_json: string
  categories_json: string
  html_body: string | null
  text_body: string | null
  headers_json: string
  in_reply_to: string | null
  references_json: string
  list_unsubscribe: string | null
  imap_flags: string
  has_remote_content: number
  body_synced: number
  is_encrypted: number
  is_focused: number
  deleted_at: string | null
}

const safeJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function mapSummary(row: MessageRow): MessageSummary {
  return {
    id: row.id,
    accountId: row.account_id,
    accountEmail: row.account_email ?? '',
    folderId: row.folder_id,
    folderKind: (row.folder_kind as FolderKind) ?? 'folder',
    threadId: row.thread_id,
    messageId: row.message_id,
    subject: row.subject || '(no subject)',
    from: { name: row.from_name || row.from_address, address: row.from_address },
    to: safeJson<MailAddress[]>(row.to_json, []),
    snippet: row.snippet,
    date: row.date,
    size: row.size,
    isRead: row.is_read === 1,
    isStarred: row.is_starred === 1,
    isImportant: row.is_important === 1,
    isDraft: row.is_draft === 1,
    isSnoozed: row.is_snoozed === 1,
    snoozeUntil: row.snooze_until,
    hasAttachments: row.has_attachments === 1,
    attachmentCount: row.attachment_count,
    labels: safeJson<string[]>(row.labels_json, []),
    categories: safeJson<string[]>(row.categories_json, []),
    hasRemoteContent: row.has_remote_content === 1,
    previewUrl: null
  }
}

export interface UpsertMessageInput {
  /** forces the row id (used so a draft row id matches its compose payload id) */
  id?: Id
  accountId: Id
  folderId: Id
  uid: number
  messageId: string | null
  subject: string
  from: MailAddress
  to: MailAddress[]
  cc?: MailAddress[]
  bcc?: MailAddress[]
  replyTo?: MailAddress[]
  date: string
  size: number
  snippet: string
  isRead: boolean
  isStarred: boolean
  isDraft?: boolean
  headers?: Record<string, string>
  inReplyTo?: string | null
  references?: string[]
  listUnsubscribe?: string | null
  hasAttachments: boolean
  attachmentCount: number
  imapFlags?: string
  html?: string | null
  text?: string | null
  hasRemoteContent?: boolean
  isFocused?: boolean
  threadId?: string
  attachmentRecords?: {
    filename: string
    mimeType: string
    size: number
    contentId: string | null
    disposition: 'attachment' | 'inline'
    kind: string
  }[]
}

const SELECT_WITH_ACCOUNT = `
  SELECT m.*, a.email AS account_email, f.kind AS folder_kind, f.name AS folder_name
  FROM messages m
  JOIN accounts a ON a.id = m.account_id
  JOIN folders f ON f.id = m.folder_id`

export class MessagesRepository {
  constructor(private readonly db: Db) {}

  /* --------------------------------------------------------------- writes */

  /** Inserts or updates a message discovered during synchronisation. */
  upsert(input: UpsertMessageInput): { id: string; isNew: boolean } {
    const existing = this.db
      .prepare('SELECT id FROM messages WHERE folder_id = ? AND uid = ?')
      .get(input.folderId, input.uid) as { id: string } | undefined

    const threadId =
      input.threadId ?? threadKeyFor(input.messageId, input.references ?? [], input.subject)

    if (existing) {
      this.db
        .prepare(
          `UPDATE messages SET
             message_id = coalesce(?, message_id),
             thread_id = ?,
             subject = ?,
             from_name = ?,
             from_address = ?,
             to_json = ?,
             cc_json = ?,
             bcc_json = ?,
             reply_to_json = ?,
             snippet = ?,
             date = ?,
             size = ?,
             is_read = ?,
             is_starred = max(is_starred, ?),
             has_attachments = ?,
             attachment_count = ?,
             headers_json = ?,
             in_reply_to = coalesce(?, in_reply_to),
             references_json = ?,
             list_unsubscribe = coalesce(?, list_unsubscribe),
             imap_flags = ?,
             is_focused = ?,
             has_remote_content = ?,
             html_body = coalesce(?, html_body),
             text_body = coalesce(?, text_body),
             body_synced = case when ? is not null then 1 else body_synced end,
             deleted_at = NULL
           WHERE id = ?`
        )
        .run(
          input.messageId,
          threadId,
          input.subject,
          input.from.name,
          input.from.address,
          JSON.stringify(input.to),
          JSON.stringify(input.cc ?? []),
          JSON.stringify(input.bcc ?? []),
          JSON.stringify(input.replyTo ?? []),
          input.snippet,
          input.date,
          input.size,
          input.isRead ? 1 : 0,
          input.isStarred ? 1 : 0,
          input.hasAttachments ? 1 : 0,
          input.attachmentCount,
          JSON.stringify(input.headers ?? {}),
          input.inReplyTo ?? null,
          JSON.stringify(input.references ?? []),
          input.listUnsubscribe ?? null,
          input.imapFlags ?? '',
          input.isFocused === false ? 0 : 1,
          input.hasRemoteContent ? 1 : 0,
          input.html ?? null,
          input.text ?? null,
          input.html ?? input.text ?? null,
          existing.id
        )
      if (input.attachmentRecords) this.replaceAttachments(existing.id, input.attachmentRecords)
      return { id: existing.id, isNew: false }
    }

    const id = input.id ?? newId()
    this.db
      .prepare(
        `INSERT INTO messages (id, account_id, folder_id, uid, message_id, thread_id, subject, from_name,
          from_address, to_json, cc_json, bcc_json, reply_to_json, snippet, date, size, is_read, is_starred,
          is_important, is_draft, has_attachments, attachment_count, headers_json, in_reply_to,
          references_json, list_unsubscribe, imap_flags, is_focused, has_remote_content, html_body,
          text_body, body_synced)
         VALUES (@id, @accountId, @folderId, @uid, @messageId, @threadId, @subject, @fromName, @fromAddress,
          @toJson, @ccJson, @bccJson, @replyToJson, @snippet, @date, @size, @isRead, @isStarred, 0, @isDraft,
          @hasAttachments, @attachmentCount, @headersJson, @inReplyTo, @referencesJson, @listUnsubscribe,
          @imapFlags, @isFocused, @hasRemoteContent, @html, @text, @bodySynced)`
      )
      .run({
        id,
        accountId: input.accountId,
        folderId: input.folderId,
        uid: input.uid,
        messageId: input.messageId,
        threadId,
        subject: input.subject,
        fromName: input.from.name,
        fromAddress: input.from.address,
        toJson: JSON.stringify(input.to),
        ccJson: JSON.stringify(input.cc ?? []),
        bccJson: JSON.stringify(input.bcc ?? []),
        replyToJson: JSON.stringify(input.replyTo ?? []),
        snippet: input.snippet,
        date: input.date,
        size: input.size,
        isRead: input.isRead ? 1 : 0,
        isStarred: input.isStarred ? 1 : 0,
        isDraft: input.isDraft ? 1 : 0,
        hasAttachments: input.hasAttachments ? 1 : 0,
        attachmentCount: input.attachmentCount,
        headersJson: JSON.stringify(input.headers ?? {}),
        inReplyTo: input.inReplyTo ?? null,
        referencesJson: JSON.stringify(input.references ?? []),
        listUnsubscribe: input.listUnsubscribe ?? null,
        imapFlags: input.imapFlags ?? '',
        isFocused: input.isFocused === false ? 0 : 1,
        hasRemoteContent: input.hasRemoteContent ? 1 : 0,
        html: input.html ?? null,
        text: input.text ?? null,
        bodySynced: input.html || input.text ? 1 : 0
      })
    if (input.attachmentRecords) this.replaceAttachments(id, input.attachmentRecords)
    return { id, isNew: true }
  }

  saveBody(
    id: Id,
    body: { html: string | null; text: string | null; blockedRemoteCount: number; headers?: Record<string, string> }
  ): void {
    this.db
      .prepare(
        `UPDATE messages SET html_body = ?, text_body = ?, blocked_remote_count = ?, body_synced = 1,
           headers_json = coalesce(?, headers_json) WHERE id = ?`
      )
      .run(
        body.html,
        body.text,
        body.blockedRemoteCount,
        body.headers ? JSON.stringify(body.headers) : null,
        id
      )
  }

  setFlags(ids: Id[], field: 'isRead' | 'isStarred' | 'isImportant', value: boolean): void {
    const column = field === 'isRead' ? 'is_read' : field === 'isStarred' ? 'is_starred' : 'is_important'
    const stmt = this.db.prepare(`UPDATE messages SET ${column} = ? WHERE id = ?`)
    const tx = this.db.transaction(() => {
      for (const id of ids) stmt.run(value ? 1 : 0, id)
    })
    tx()
  }

  snooze(ids: Id[], until: string): void {
    const stmt = this.db.prepare('UPDATE messages SET is_snoozed = 1, snooze_until = ?, is_read = 1 WHERE id = ?')
    const tx = this.db.transaction(() => ids.forEach((id) => stmt.run(until, id)))
    tx()
  }

  unsnooze(ids: Id[]): void {
    const stmt = this.db.prepare('UPDATE messages SET is_snoozed = 0, snooze_until = NULL WHERE id = ?')
    const tx = this.db.transaction(() => ids.forEach((id) => stmt.run(id)))
    tx()
  }

  /** Returns snoozed messages whose timer elapsed, and clears their snooze flag. */
  dueSnoozes(now = nowIso()): MessageSummary[] {
    const rows = this.db
      .prepare(
        `${SELECT_WITH_ACCOUNT} WHERE m.is_snoozed = 1 AND m.snooze_until IS NOT NULL AND m.snooze_until <= ?`
      )
      .all(now) as MessageRow[]
    if (rows.length > 0) {
      const stmt = this.db.prepare('UPDATE messages SET is_snoozed = 0, snooze_until = NULL WHERE id = ?')
      const tx = this.db.transaction(() => rows.forEach((r) => stmt.run(r.id)))
      tx()
    }
    return rows.map(mapSummary)
  }

  move(ids: Id[], folderId: Id): void {
    const stmt = this.db.prepare(
      `UPDATE messages SET folder_id = ?, uid = -abs(random() % 1000000000) - 1,
         is_snoozed = 0, snooze_until = NULL, deleted_at = NULL WHERE id = ?`
    )
    const tx = this.db.transaction(() => ids.forEach((id) => stmt.run(folderId, id)))
    tx()
  }

  remove(ids: Id[]): void {
    const stmt = this.db.prepare('DELETE FROM messages WHERE id = ?')
    const tx = this.db.transaction(() => ids.forEach((id) => stmt.run(id)))
    tx()
  }

  removeByFolder(folderId: Id): void {
    this.db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folderId)
  }

  addLabel(ids: Id[], label: string): void {
    for (const id of ids) {
      const row = this.db.prepare('SELECT labels_json FROM messages WHERE id = ?').get(id) as
        | { labels_json: string }
        | undefined
      if (!row) continue
      const labels = new Set(safeJson<string[]>(row.labels_json, []))
      labels.add(label)
      this.db.prepare('UPDATE messages SET labels_json = ? WHERE id = ?').run(JSON.stringify([...labels]), id)
    }
  }

  removeLabel(ids: Id[], label: string): void {
    for (const id of ids) {
      const row = this.db.prepare('SELECT labels_json FROM messages WHERE id = ?').get(id) as
        | { labels_json: string }
        | undefined
      if (!row) continue
      const labels = safeJson<string[]>(row.labels_json, []).filter((l) => l !== label)
      this.db.prepare('UPDATE messages SET labels_json = ? WHERE id = ?').run(JSON.stringify(labels), id)
    }
  }

  listLabels(accountId?: Id): { label: string; count: number }[] {
    const rows = this.db
      .prepare(`SELECT labels_json, account_id FROM messages WHERE labels_json != '[]'`)
      .all() as { labels_json: string; account_id: string }[]
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (accountId && row.account_id !== accountId) continue
      for (const label of safeJson<string[]>(row.labels_json, [])) {
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
  }

  markFolderRead(folderId: Id): void {
    this.db.prepare('UPDATE messages SET is_read = 1 WHERE folder_id = ?').run(folderId)
  }

  /** Server UID of a message (0 for locally created rows). */
  uid(id: Id): number {
    const row = this.db.prepare('SELECT uid FROM messages WHERE id = ?').get(id) as { uid: number } | undefined
    return row?.uid ?? 0
  }

  maxUid(folderId: Id): number {
    const row = this.db.prepare('SELECT max(uid) AS m FROM messages WHERE folder_id = ?').get(folderId) as {
      m: number | null
    }
    return row.m ?? 0
  }

  /** Next free negative UID for locally created rows (no server counterpart). */
  localUid(): number {
    const row = this.db.prepare('SELECT min(uid) AS m FROM messages WHERE uid < 0').get() as { m: number | null }
    return (row.m ?? 0) - 1
  }

  /* ---------------------------------------------------------------- reads */

  get(id: Id): MessageDetail | null {
    const row = this.db.prepare(`${SELECT_WITH_ACCOUNT} WHERE m.id = ?`).get(id) as MessageRow | undefined
    if (!row) return null
    const attachments = this.db
      .prepare('SELECT * FROM attachments WHERE message_id = ? ORDER BY rowid')
      .all(id) as AttachmentRowLite[]
    const summary = mapSummary(row)
    const headers = safeJson<Record<string, string>>(row.headers_json, {})
    return {
      ...summary,
      to: safeJson<MailAddress[]>(row.to_json, []),
      cc: safeJson<MailAddress[]>(row.cc_json, []),
      bcc: safeJson<MailAddress[]>(row.bcc_json, []),
      replyTo: safeJson<MailAddress[]>(row.reply_to_json, []),
      html: row.html_body,
      text: row.text_body,
      attachments: attachments.map((a) => ({
        id: a.id,
        messageId: a.message_id,
        filename: a.filename,
        mimeType: a.mime_type,
        size: a.size,
        contentId: a.content_id,
        disposition: a.disposition as 'attachment' | 'inline',
        kind: a.kind as never,
        isInline: a.disposition === 'inline',
        checksum: a.checksum,
        cached: Boolean(a.cache_path)
      })),
      blockedRemoteContentCount: row.blocked_remote_count,
      isEncrypted: row.is_encrypted === 1,
      signatureVerified: 'none',
      headers,
      inReplyTo: row.in_reply_to,
      references: safeJson<string[]>(row.references_json, []),
      listUnsubscribe: row.list_unsubscribe
    }
  }

  list(query: MessageListQuery): MessageListResult {
    const { where, params } = this.buildWhere(query)
    const sortColumn = {
      date: 'm.date',
      sender: 'm.from_name',
      subject: 'm.subject',
      size: 'm.size'
    }[query.sort ?? 'date']
    const direction = query.direction ?? 'desc'
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
    const offset = Math.max(query.offset ?? 0, 0)

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM messages m JOIN folders f ON f.id = m.folder_id ${where}`).get(
        ...params
      ) as { c: number }
    ).c

    const rows = this.db
      .prepare(
        `${SELECT_WITH_ACCOUNT} ${where} ORDER BY ${sortColumn} ${direction.toUpperCase()}, m.id LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as MessageRow[]

    const items = rows.map(mapSummary)
    this.decorateThreads(items, query)
    return { items, total, hasMore: offset + items.length < total }
  }

  private decorateThreads(items: MessageSummary[], query: MessageListQuery): void {
    if (items.length === 0) return
    const threadIds = [...new Set(items.map((i) => i.threadId))]
    const placeholders = threadIds.map(() => '?').join(',')
    const counts = this.db
      .prepare(
        `SELECT thread_id, COUNT(*) AS c, MAX(date) AS newest FROM messages
         WHERE thread_id IN (${placeholders}) AND deleted_at IS NULL GROUP BY thread_id`
      )
      .all(...threadIds) as { thread_id: string; c: number; newest: string }[]
    const map = new Map(counts.map((c) => [c.thread_id, c]))
    for (const item of items) {
      const entry = map.get(item.threadId)
      item.threadCount = entry?.c ?? 1
      item.isFirstInThread = entry ? entry.newest === item.date : true
    }
    if (query.mailbox === 'unified' || query.mailbox === 'focused' || query.mailbox === 'other') {
      // duplicate-message handling: same Message-ID in several folders shows once
      const seen = new Set<string>()
      const deduped: MessageSummary[] = []
      for (const item of items) {
        const key = item.messageId ?? item.id
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(item)
      }
      items.length = 0
      items.push(...deduped)
    }
  }

  private buildWhere(query: MessageListQuery): { where: string; params: unknown[] } {
    const clauses: string[] = ['m.deleted_at IS NULL']
    const params: unknown[] = []

    if (query.accountId && query.accountId !== 'all') {
      clauses.push('m.account_id = ?')
      params.push(query.accountId)
    }

    const mailbox = query.mailbox || 'unified'
    if (mailbox.startsWith('folder:')) {
      clauses.push('m.folder_id = ?')
      params.push(mailbox.slice('folder:'.length))
    } else if (mailbox.startsWith('label:')) {
      clauses.push("m.labels_json LIKE ?")
      params.push(`%${JSON.stringify(mailbox.slice('label:'.length)).slice(1, -1)}%`)
    } else {
      switch (mailbox) {
        case 'unified':
          clauses.push("f.kind = 'inbox'")
          break
        case 'focused':
          clauses.push("f.kind = 'inbox' AND m.is_focused = 1")
          break
        case 'other':
          clauses.push("f.kind = 'inbox' AND m.is_focused = 0")
          break
        case 'starred':
          clauses.push("m.is_starred = 1 AND f.kind NOT IN ('trash','spam')")
          break
        case 'important':
          clauses.push("m.is_important = 1 AND f.kind NOT IN ('trash','spam')")
          break
        case 'drafts':
          clauses.push("(f.kind = 'drafts' OR m.is_draft = 1)")
          break
        case 'sent':
          clauses.push("f.kind = 'sent'")
          break
        case 'archive':
          clauses.push("f.kind = 'archive'")
          break
        case 'spam':
          clauses.push("f.kind = 'spam'")
          break
        case 'trash':
          clauses.push("f.kind = 'trash'")
          break
        case 'snoozed':
          clauses.push('m.is_snoozed = 1')
          break
        case 'all':
          // global search / everything view: no folder restriction
          break
        default:
          clauses.push('m.folder_id = ?')
          params.push(mailbox)
      }
    }

    if (!query.includeSnoozed && mailbox !== 'snoozed') clauses.push('m.is_snoozed = 0')
    if (query.unreadOnly) clauses.push('m.is_read = 0')
    if (query.starredOnly) clauses.push('m.is_starred = 1')
    if (query.attachmentsOnly) clauses.push('m.has_attachments = 1')
    if (query.focusedOnly) clauses.push("f.kind = 'inbox' AND m.is_focused = 1")
    if (query.otherOnly) clauses.push("f.kind = 'inbox' AND m.is_focused = 0")
    if (query.fromDate) {
      clauses.push('m.date >= ?')
      params.push(query.fromDate)
    }
    if (query.toDate) {
      clauses.push('m.date <= ?')
      params.push(query.toDate)
    }
    if (query.label) {
      clauses.push('m.labels_json LIKE ?')
      params.push(`%${query.label}%`)
    }
    if (query.fromFilter) {
      clauses.push('(lower(m.from_address) LIKE ? OR lower(m.from_name) LIKE ?)')
      params.push(`%${query.fromFilter.toLowerCase()}%`, `%${query.fromFilter.toLowerCase()}%`)
    }
    if (query.toFilter) {
      clauses.push('lower(m.to_json) LIKE ?')
      params.push(`%${query.toFilter.toLowerCase()}%`)
    }
    if (query.subjectFilter) {
      clauses.push('lower(m.subject) LIKE ?')
      params.push(`%${query.subjectFilter.toLowerCase()}%`)
    }
    if (query.filenameFilter) {
      clauses.push('EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND lower(a.filename) LIKE ?)')
      params.push(`%${query.filenameFilter.toLowerCase()}%`)
    }
    if (typeof query.minSize === 'number' && query.minSize > 0) {
      clauses.push('m.size >= ?')
      params.push(query.minSize)
    }
    // Search results default to real mail; explicit trash/spam views keep working.
    if (!query.includeDeleted && (query.search || mailbox === 'all')) {
      clauses.push("(f.kind NOT IN ('trash','spam') OR m.is_starred = 1)")
    }
    if (query.search) {
      const match = buildFtsMatch(query.search)
      if (match) {
        clauses.push('m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)')
        params.push(match)
      }
    }

    return { where: `WHERE ${clauses.join(' AND ')}`, params }
  }

  thread(threadId: string): MessageSummary[] {
    const rows = this.db
      .prepare(`${SELECT_WITH_ACCOUNT} WHERE m.thread_id = ? AND m.deleted_at IS NULL ORDER BY m.date ASC`)
      .all(threadId) as MessageRow[]
    return rows.map(mapSummary)
  }

  findByMessageId(messageId: string): MessageSummary[] {
    const rows = this.db
      .prepare(`${SELECT_WITH_ACCOUNT} WHERE m.message_id = ? ORDER BY m.date DESC`)
      .all(messageId) as MessageRow[]
    return rows.map(mapSummary)
  }

  /** Messages that still need their body fetched from the server. */
  pendingBodyIds(folderId: Id, limit = 25): { id: Id; uid: number }[] {
    return this.db
      .prepare(
        'SELECT id, uid FROM messages WHERE folder_id = ? AND body_synced = 0 AND uid > 0 ORDER BY date DESC LIMIT ?'
      )
      .all(folderId, limit) as { id: Id; uid: number }[]
  }

  countAll(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c
  }

  countUnread(): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS c FROM messages m JOIN folders f ON f.id=m.folder_id WHERE m.is_read=0 AND f.kind NOT IN ('trash','spam','drafts')")
        .get() as { c: number }
    ).c
  }

  foldersWithCounts(): { id: Id; accountId: Id; unread: number }[] {
    return this.db
      .prepare(
        `SELECT folder_id AS id, account_id AS accountId, COUNT(*) AS unread FROM messages
         WHERE is_read = 0 AND deleted_at IS NULL GROUP BY folder_id`
      )
      .all() as { id: Id; accountId: Id; unread: number }[]
  }

  private replaceAttachments(messageId: Id, records: NonNullable<UpsertMessageInput['attachmentRecords']>): void {
    this.db.prepare('DELETE FROM attachments WHERE message_id = ?').run(messageId)
    const stmt = this.db.prepare(
      `INSERT INTO attachments (id, message_id, filename, mime_type, size, content_id, disposition, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const tx = this.db.transaction(() => {
      for (const record of records) {
        stmt.run(
          newId(),
          messageId,
          record.filename,
          record.mimeType,
          record.size,
          record.contentId,
          record.disposition,
          record.kind,
          nowIso()
        )
      }
    })
    tx()
  }
}

interface AttachmentRowLite {
  id: string
  message_id: string
  filename: string
  mime_type: string
  size: number
  content_id: string | null
  disposition: string
  kind: string
  cache_path: string | null
  checksum: string | null
}
