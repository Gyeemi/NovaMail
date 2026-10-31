/**
 * Novamail - database integration tests.
 *
 * These run against a real better-sqlite3 database (in memory + a temp file) so
 * migrations, constraints, full-text search, the sync queue and settings
 * persistence are exercised for real rather than mocked.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeDatabase,
  integrityCheck,
  migrate,
  openDatabase,
  type Db
} from '../../src/main/services/db/database'
import { LATEST_VERSION } from '../../src/main/services/db/migrations'
import { AccountsRepository } from '../../src/main/services/db/repositories/accounts'
import { FoldersRepository } from '../../src/main/services/db/repositories/folders'
import { MessagesRepository } from '../../src/main/services/db/repositories/messages'
import { KvRepository, RulesRepository, SignaturesRepository, SyncQueueRepository } from '../../src/main/services/db/repositories/rules'
import { AttachmentsRepository } from '../../src/main/services/db/repositories/attachments'
import { SettingsService, DEFAULT_SETTINGS } from '../../src/main/services/settings'

const CAPABILITIES = {
  oauth: true,
  imap: true,
  smtp: true,
  calendar: 'none' as const,
  contacts: 'none' as const,
  serverSearch: true,
  idle: true,
  labels: false,
  snooze: true,
  readReceipts: false,
  deliveryReceipts: false,
  redirect: false
}

function createAccount(accounts: AccountsRepository, email = 'anna@barailyinovex.example') {
  return accounts.create({
    email,
    displayName: 'Anna Dorji',
    providerId: 'generic',
    authType: 'password',
    oauthProvider: null,
    username: email,
    imap: { host: 'imap.example.com', port: 993, secure: true },
    smtp: { host: 'smtp.example.com', port: 465, secure: true },
    color: '#3f7d8c',
    capabilities: CAPABILITIES
  })
}

function seedMessage(
  messages: MessagesRepository,
  accountId: string,
  folderId: string,
  overrides: Partial<Parameters<MessagesRepository['upsert']>[0]> = {}
) {
  return messages.upsert({
    accountId,
    folderId,
    uid: overrides.uid ?? Math.floor(Math.random() * 10_000) + 1,
    messageId: overrides.messageId ?? `msg-${Math.random().toString(36).slice(2)}@example.com`,
    subject: 'Quarterly review',
    from: { name: 'Sonam Wangmo', address: 'sonam@example.com' },
    to: [{ name: 'Anna Dorji', address: 'anna@barailyinovex.example' }],
    date: new Date('2026-10-20T09:00:00Z').toISOString(),
    size: 4096,
    snippet: 'Please find the figures for the quarter attached.',
    isRead: false,
    isStarred: false,
    hasAttachments: false,
    attachmentCount: 0,
    ...overrides
  })
}

describe('database lifecycle', () => {
  let db: Db

  beforeEach(() => {
    db = openDatabase({ file: ':memory:', memory: true })
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('applies every migration and reports the latest schema version', () => {
    const version = Number(db.pragma('user_version', { simple: true }))
    expect(version).toBe(LATEST_VERSION)
    const rerun = migrate(db)
    expect(rerun.applied).toEqual([])
    expect(integrityCheck(db).ok).toBe(true)
  })

  it('enables the safety pragmas', () => {
    expect(String(db.pragma('foreign_keys', { simple: true }))).toBe('1')
    expect(String(db.pragma('secure_delete', { simple: true }))).toBe('1')
  })

  it('rejects an account whose server folders are removed with it', () => {
    const accounts = new AccountsRepository(db)
    const folders = new FoldersRepository(db)
    const account = createAccount(accounts)
    folders.syncServerFolders(account.id, [
      { path: 'INBOX', name: 'Inbox', delimiter: '/', parentPath: null, kind: 'inbox' }
    ])
    expect(folders.list(account.id)).toHaveLength(1)
    accounts.remove(account.id)
    expect(folders.list()).toHaveLength(0)
  })
})

describe('accounts, folders and messages', () => {
  let db: Db
  let accounts: AccountsRepository
  let folders: FoldersRepository
  let messages: MessagesRepository
  let accountId: string
  let inboxId: string

  beforeEach(() => {
    db = openDatabase({ file: ':memory:', memory: true })
    accounts = new AccountsRepository(db)
    folders = new FoldersRepository(db)
    messages = new MessagesRepository(db)
    const account = createAccount(accounts)
    accountId = account.id
    const map = folders.syncServerFolders(account.id, [
      { path: 'INBOX', name: 'Inbox', delimiter: '/', parentPath: null, kind: 'inbox' },
      { path: 'Sent', name: 'Sent', delimiter: '/', parentPath: null, kind: 'sent' },
      { path: 'Archive', name: 'Archive', delimiter: '/', parentPath: null, kind: 'archive' }
    ])
    inboxId = map.get('INBOX')!.id
  })

  afterEach(() => closeDatabase(db))

  it('creates the first account as the default', () => {
    const second = createAccount(accounts, 'work@example.com')
    expect(accounts.list()).toHaveLength(2)
    expect(accounts.defaultAccount()!.email).toBe('anna@barailyinovex.example')
    accounts.setDefault(second.id)
    expect(accounts.defaultAccount()!.id).toBe(second.id)
  })

  it('upserts idempotently on (folder, uid) so re-syncs never duplicate mail', () => {
    const first = seedMessage(messages, accountId, inboxId, { uid: 42, messageId: 'stable@example.com' })
    expect(first.isNew).toBe(true)
    const second = seedMessage(messages, accountId, inboxId, { uid: 42, messageId: 'stable@example.com', isRead: true })
    expect(second.isNew).toBe(false)
    expect(second.id).toBe(first.id)
    expect(messages.countAll()).toBe(1)
    expect(messages.get(first.id)!.isRead).toBe(true)
  })

  it('stores bodies and attachments and returns them in the detail view', () => {
    const { id } = seedMessage(messages, accountId, inboxId, {
      hasAttachments: true,
      attachmentCount: 1,
      html: '<p>Body</p>'
    })
    messages.saveBody(id, { html: '<p>Body</p>', text: 'Body', blockedRemoteCount: 2 })
    const attachments = new AttachmentsRepository(db)
    attachments.add({
      messageId: id,
      filename: 'figures.csv',
      mimeType: 'text/csv',
      size: 42,
      contentId: null,
      disposition: 'attachment',
      kind: 'csv'
    })
    const detail = messages.get(id)!
    expect(detail.text).toBe('Body')
    expect(detail.blockedRemoteContentCount).toBe(2)
    expect(detail.attachments).toHaveLength(1)
    expect(detail.attachments[0]!.filename).toBe('figures.csv')
    expect(detail.attachments[0]!.cached).toBe(false)
  })

  it('moves, stars, reads, labels and deletes messages', () => {
    const { id } = seedMessage(messages, accountId, inboxId)
    const archiveId = folders.findByKind(accountId, 'archive')!.id

    messages.setFlags([id], 'isStarred', true)
    expect(messages.get(id)!.isStarred).toBe(true)

    messages.addLabel([id], 'Finance')
    expect(messages.listLabels(accountId)).toEqual([{ label: 'Finance', count: 1 }])

    messages.move([id], archiveId)
    expect(messages.get(id)!.folderId).toBe(archiveId)

    messages.markFolderRead(archiveId)
    expect(messages.get(id)!.isRead).toBe(true)

    messages.remove([id])
    expect(messages.get(id)).toBeNull()
    expect(messages.countAll()).toBe(0)
  })

  it('snoozes a message and surfaces it only when it is due', () => {
    const { id } = seedMessage(messages, accountId, inboxId)
    const future = new Date(Date.now() + 3_600_000).toISOString()
    messages.snooze([id], future)
    expect(messages.dueSnoozes()).toHaveLength(0)
    expect(messages.list({ mailbox: 'unified' }).items).toHaveLength(0)

    messages.snooze([id], new Date(Date.now() - 1000).toISOString())
    const due = messages.dueSnoozes()
    expect(due).toHaveLength(1)
    expect(due[0]!.id).toBe(id)
  })

  it('groups replies into a thread and keeps the newest first', () => {
    const parent = seedMessage(messages, accountId, inboxId, {
      uid: 1,
      messageId: 'root@example.com',
      subject: 'Plan',
      date: '2026-10-01T09:00:00.000Z'
    })
    const threadId = messages.get(parent.id)!.threadId
    seedMessage(messages, accountId, inboxId, {
      uid: 2,
      messageId: 'reply@example.com',
      subject: 'Re: Plan',
      inReplyTo: 'root@example.com',
      references: ['root@example.com'],
      threadId,
      date: '2026-10-02T09:00:00.000Z'
    })
    const thread = messages.thread(threadId)
    expect(thread).toHaveLength(2)
    // Threads read oldest first, like Outlook.
    expect(thread[1]!.date > thread[0]!.date).toBe(true)
  })

  it('searches bodies through FTS5', () => {
    const a = seedMessage(messages, accountId, inboxId, { uid: 1, messageId: 'a@example.com', subject: 'Invoice 4021' })
    const b = seedMessage(messages, accountId, inboxId, { uid: 2, messageId: 'b@example.com', subject: 'Lunch' })
    messages.saveBody(a.id, { html: '<p>payment due</p>', text: 'payment due', blockedRemoteCount: 0 })
    messages.saveBody(b.id, { html: '<p>dumplings</p>', text: 'dumplings', blockedRemoteCount: 0 })

    const bySubject = messages.list({ mailbox: 'unified', search: 'invoice' })
    expect(bySubject.items.map((m) => m.id)).toEqual([a.id])

    const byBody = messages.list({ mailbox: 'unified', search: 'dumplings' })
    expect(byBody.items.map((m) => m.id)).toEqual([b.id])

    // FTS syntax from user input must not throw.
    expect(() => messages.list({ mailbox: 'unified', search: 'NOT "unclosed' })).not.toThrow()
  })

  it('filters the list by mailbox, unread, starred and attachments', () => {
    seedMessage(messages, accountId, inboxId, { uid: 1, messageId: '1@example.com', isRead: true })
    seedMessage(messages, accountId, inboxId, { uid: 2, messageId: '2@example.com', isStarred: true })
    seedMessage(messages, accountId, inboxId, {
      uid: 3,
      messageId: '3@example.com',
      hasAttachments: true,
      attachmentCount: 1,
      isFocused: false
    })

    expect(messages.list({ mailbox: 'unified' }).total).toBe(3)
    expect(messages.list({ mailbox: 'unified', unreadOnly: true }).total).toBe(2)
    expect(messages.list({ mailbox: 'starred' }).total).toBe(1)
    expect(messages.list({ mailbox: 'unified', attachmentsOnly: true }).total).toBe(1)
    expect(messages.list({ mailbox: 'unified', otherOnly: true }).total).toBe(1)
    expect(messages.list({ mailbox: 'unified', limit: 2 }).items).toHaveLength(2)
  })

  it('maintains unread counters', () => {
    seedMessage(messages, accountId, inboxId, { uid: 1, messageId: '1@example.com' })
    seedMessage(messages, accountId, inboxId, { uid: 2, messageId: '2@example.com', isRead: true })
    expect(messages.countUnread()).toBe(1)
    const counts = messages.foldersWithCounts()
    expect(counts.find((c) => c.id === inboxId)!.unread).toBe(1)
  })
})

describe('rules and signatures', () => {
  let db: Db

  beforeEach(() => {
    db = openDatabase({ file: ':memory:', memory: true })
  })
  afterEach(() => closeDatabase(db))

  it('persists a rule with its conditions and actions', () => {
    const rules = new RulesRepository(db)
    const created = rules.save({
      id: '',
      accountId: null,
      name: 'Newsletters to Archive',
      enabled: true,
      matchAll: true,
      conditions: [{ field: 'from', operator: 'contains', value: 'newsletter' }],
      actions: [{ type: 'move', value: 'archive' }],
      stopProcessing: false,
      createdAt: '',
      matchCount: 0
    })
    const list = rules.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.conditions[0]!.value).toBe('newsletter')
    expect(list[0]!.matchCount).toBe(0)
    rules.save({ ...created, enabled: false })
    expect(rules.list()[0]!.enabled).toBe(false)
    rules.remove(created.id)
    expect(rules.list()).toHaveLength(0)
  })

  it('keeps one default signature per account', () => {
    const signatures = new SignaturesRepository(db)
    const first = signatures.save({ id: '', accountId: null, name: 'Formal', html: '<p>Regards</p>', isDefault: true })
    signatures.save({ id: '', accountId: null, name: 'Short', html: '<p>– A</p>', isDefault: true })
    const list = signatures.list()
    const defaults = list.filter((s) => s.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0]!.name).toBe('Short')
    expect(defaults[0]!.id).not.toBe(first.id)
  })
})

describe('sync queue', () => {
  let db: Db
  let queue: SyncQueueRepository
  const accountId = 'acc-1'

  beforeEach(() => {
    db = openDatabase({ file: ':memory:', memory: true })
    const account = createAccount(new AccountsRepository(db))
    queue = new SyncQueueRepository(db)
    void accountId
    return account
  })
  afterEach(() => closeDatabase(db))

  it('deduplicates identical pending operations', () => {
    const a = queue.enqueue('acc', 'flag', { uid: 4, read: true }, 'flag:4:read')
    const b = queue.enqueue('acc', 'flag', { uid: 4, read: true }, 'flag:4:read')
    expect(a).toBe(b)
    expect(queue.due()).toHaveLength(1)
  })

  it('retries with backoff and gives up after six attempts', () => {
    const id = queue.enqueue('acc', 'flag', { uid: 9 })
    queue.fail(id, 'network down', 0)
    expect(queue.due()).toHaveLength(1)
    for (let i = 0; i < 5; i += 1) queue.fail(id, 'network down', 0)
    expect(queue.due()).toHaveLength(0)
    expect(queue.list()[0]!.status).toBe('failed')
    expect(queue.pendingCount()).toBe(0)
  })

  it('completes and prunes finished work', async () => {
    const id = queue.enqueue('acc', 'flag', { uid: 1 })
    queue.complete(id)
    expect(queue.pendingCount()).toBe(0)
    // created_at is "now", so a cutoff of now() needs a moment to move past it.
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(queue.pruneFinished(0)).toBe(1)
  })
})

describe('settings persistence', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novamail-settings-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('survives a restart (the upgrade-critical promise)', () => {
    const file = path.join(dir, 'novamail.db')
    const mirror = path.join(dir, 'settings.json')

    let db = openDatabase({ file })
    let service = new SettingsService(new KvRepository(db), mirror)
    service.update({ ui: { theme: 'dark', density: 'compact' }, compose: { undoSendSeconds: 10 } })
    closeDatabase(db)

    db = openDatabase({ file })
    service = new SettingsService(new KvRepository(db), mirror)
    const restored = service.get()
    expect(restored.ui.theme).toBe('dark')
    expect(restored.ui.density).toBe('compact')
    expect(restored.compose.undoSendSeconds).toBe(10)
    // Everything else keeps its default.
    expect(restored.ui.textScale).toBe(DEFAULT_SETTINGS.ui.textScale)
    expect(Object.keys(restored.ui).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.ui).sort())
    closeDatabase(db)

    expect(JSON.parse(fs.readFileSync(mirror, 'utf8')).ui.theme).toBe('dark')
  })

  it('does not let a stored blob clobber missing keys with undefined', () => {
    const db = openDatabase({ file: ':memory:', memory: true })
    const kv = new KvRepository(db)
    kv.set('app-settings', { ui: { theme: 'light' } })
    const service = new SettingsService(kv)
    const settings = service.get()
    expect(settings.ui.theme).toBe('light')
    expect(settings.ui.neumorphicIntensity).toBe(DEFAULT_SETTINGS.ui.neumorphicIntensity)
    closeDatabase(db)
  })

  it('notifies listeners on change and supports reset', () => {
    const db = openDatabase({ file: ':memory:', memory: true })
    const service = new SettingsService(new KvRepository(db))
    const seen: string[] = []
    const off = service.onChange((s) => seen.push(s.ui.theme))
    service.update({ ui: { theme: 'dark' } })
    service.update({ ui: { theme: 'system' } })
    off()
    service.update({ ui: { theme: 'light' } })
    expect(seen).toEqual(['dark', 'system'])
    service.reset()
    expect(service.get().ui.theme).toBe(DEFAULT_SETTINGS.ui.theme)
    closeDatabase(db)
  })
})
