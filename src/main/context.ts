/**
 * Novamail - application context.
 *
 * One place where every service is constructed and wired. The renderer only ever
 * talks to these through validated IPC handlers.
 */
import fs from 'node:fs'
import type { Account, MessageSummary } from '@shared/types'
import type { AppPaths } from './util/paths'
import { createLogger, getLogTail } from './util/logger'
import { openDatabase, closeDatabase, integrityCheck } from './services/db/database'
import type { Db } from './services/db/database'
import { AccountsRepository } from './services/db/repositories/accounts'
import { FoldersRepository } from './services/db/repositories/folders'
import { MessagesRepository } from './services/db/repositories/messages'
import { AttachmentsRepository } from './services/db/repositories/attachments'
import { ComposeRepository } from './services/db/repositories/compose'
import { CalendarRepository, ContactsRepository, TasksRepository } from './services/db/repositories/productivity'
import {
  KvRepository,
  RulesRepository,
  SearchHistoryRepository,
  SignaturesRepository,
  SyncQueueRepository
} from './services/db/repositories/rules'
import { SettingsService } from './services/settings'
import { CredentialStore } from './services/credentials'
import type { SecretBackend } from './services/credentials'
import { OAuthService } from './services/oauth/service'
import { SessionManager } from './services/mail/sessions'
import { MailService } from './services/mail/mailService'
import { SyncEngine } from './services/sync/syncEngine'
import type { SyncNotifier } from './services/sync/syncEngine'
import { SearchService } from './services/search/service'
import { AttachmentCache } from './services/attachments/cache'
import { AttachmentService } from './services/attachments/service'
import { AccountService } from './services/accounts/service'
import { BackupService } from './services/backup/backup'
import { parseRawMessage } from './services/mail/parse'
import { appEvents } from './util/events'
import { newId } from './util/ids'

const log = createLogger('context')

export interface AppContextOptions {
  paths: AppPaths
  version: string
  secretBackend: SecretBackend
  openExternal: (url: string) => Promise<unknown>
  notifier: SyncNotifier
  dataRoot: string
}

export interface AppContext {
  paths: AppPaths
  db: Db
  version: string
  startedAt: number
  integrity: { ok: boolean; details: string[] }
  logTail: () => string[]
  settings: SettingsService
  credentials: CredentialStore
  oauth: OAuthService
  accounts: AccountsRepository
  accountService: AccountService
  folders: FoldersRepository
  messages: MessagesRepository
  attachmentsRepo: AttachmentsRepository
  compose: ComposeRepository
  contacts: ContactsRepository
  calendar: CalendarRepository
  tasks: TasksRepository
  rules: RulesRepository
  signatures: SignaturesRepository
  searchHistory: SearchHistoryRepository
  queue: SyncQueueRepository
  kv: KvRepository
  sessions: SessionManager
  mail: MailService
  sync: SyncEngine
  search: SearchService
  attachments: AttachmentService
  attachmentCache: AttachmentCache
  backup: BackupService
  close: () => Promise<void>
}

export function createContext(options: AppContextOptions): AppContext {
  const { paths } = options
  for (const dir of [paths.root, paths.logsDir, paths.attachmentCacheDir, paths.previewCacheDir, paths.tempDir, paths.backupsDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const db = openDatabase({ file: paths.databaseFile })
  const integrity = integrityCheck(db)
  if (!integrity.ok) log.error('database integrity check reported problems', { details: integrity.details })

  const kv = new KvRepository(db)
  const settings = new SettingsService(kv, paths.settingsFile)
  const credentials = new CredentialStore(paths.credentialsFile, options.secretBackend)

  const accounts = new AccountsRepository(db)
  const folders = new FoldersRepository(db)
  const messages = new MessagesRepository(db)
  const attachmentsRepo = new AttachmentsRepository(db)
  const compose = new ComposeRepository(db)
  const contacts = new ContactsRepository(db)
  const calendar = new CalendarRepository(db)
  const tasks = new TasksRepository(db)
  const rules = new RulesRepository(db)
  const signatures = new SignaturesRepository(db)
  const searchHistory = new SearchHistoryRepository(db)
  const queue = new SyncQueueRepository(db)

  const oauth = new OAuthService({
    configFile: `${paths.root}/oauth.json`,
    openExternal: options.openExternal
  })

  const sessions = new SessionManager({ accounts, credentials, oauth })

  const attachmentCache = new AttachmentCache(paths.attachmentCacheDir, {
    retentionDays: settings.get().privacy.autoDeleteTempFilesDays,
    maxTotalBytes: 2 * 1024 * 1024 * 1024
  })

  const attachments = new AttachmentService({
    repository: attachmentsRepo,
    cache: attachmentCache,
    getPreviewLimit: () => {
      const current = settings.get()
      return {
        maxBytes: current.attachmentPreview.maxPreviewBytes,
        officePreviews: current.attachmentPreview.officePreviews
      }
    }
  })

  const mail = new MailService({
    accounts,
    folders,
    messages,
    attachmentsRepo,
    compose,
    contacts,
    queue,
    kv,
    settings,
    sessions,
    attachments
  })

  const sync = new SyncEngine({
    accounts,
    folders,
    messages,
    queue,
    compose,
    rules,
    calendar,
    settings,
    sessions,
    attachments,
    mail,
    notifier: options.notifier
  })

  const search = new SearchService({ messages, history: searchHistory, accounts, folders, contacts, sessions })

  const accountService = new AccountService({
    accounts,
    folders,
    credentials,
    oauth,
    sessions,
    settings,
    onAccountCreated: (account: Account) => {
      accountService.ensureFolderSkeleton(account.id)
      appEvents.emit('folders:changed', { accountId: account.id })
      // Kick off the first synchronisation in the background.
      setTimeout(() => {
        void sync.syncAccount(account.id)
      }, 500)
    },
    onAccountRemoved: (accountId: string) => {
      sync.stopIdle(accountId)
    }
  })

  // Attachment bytes are fetched on demand through the IMAP session.
  attachments.setDownloader(async (request) => {
    const message = messages.get(request.messageId)
    if (!message) throw new Error('The message for this attachment is no longer available.')
    const folder = folders.get(message.folderId)
    if (!folder) throw new Error('The folder for this message is no longer available.')

    const parsed = await sessions.withSession(request.accountId, async (session) => {
      const { source } = await session.downloadMessage(folder.path, request.uid)
      return parseRawMessage(source)
    })

    const byName = parsed.attachments.find((attachment) => attachment.filename === request.filename)
    const match = byName ?? parsed.attachments[0]
    if (!match) throw new Error('This attachment could not be found inside the message.')
    return match.content
  })

  settings.onChange((updated) => {
    attachmentCache.setOptions({ retentionDays: updated.privacy.autoDeleteTempFilesDays })
    appEvents.emit('settings:changed', updated)
  })

  return {
    paths,
    db,
    version: options.version,
    startedAt: Date.now(),
    integrity,
    logTail: () => getLogTail(200),
    settings,
    credentials,
    oauth,
    accounts,
    accountService,
    folders,
    messages,
    attachmentsRepo,
    compose,
    contacts,
    calendar,
    tasks,
    rules,
    signatures,
    searchHistory,
    queue,
    kv,
    sessions,
    mail,
    sync,
    search,
    attachments,
    attachmentCache,
    backup: new BackupService({ db, settings }),
    close: async () => {
      sync.stop()
      await sessions.closeAll()
      closeDatabase(db)
    }
  }
}

/** Toast helper shared by IPC handlers. */
export function toast(
  context: AppContext,
  tone: 'info' | 'success' | 'warning' | 'error',
  title: string,
  description?: string
): void {
  appEvents.emit('toast', { id: newId(), tone, title, description })
  log.debug('toast', { tone, title })
  void context
}

export type { MessageSummary }
