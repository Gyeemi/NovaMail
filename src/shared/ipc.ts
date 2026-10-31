/**
 * Novamail - typed IPC contract.
 *
 * The renderer-facing API (NovaMailApi) is the single source of truth.
 * Channel names are derived from it (`group:method`), payloads are validated
 * with zod in the main process before touching a service.
 */
import type {
  Account,
  AccountDraftInput,
  AppInfo,
  AppSettings,
  AttachmentDetail,
  AttachmentMeta,
  AttachmentPreview,
  Attendee,
  BackupManifest,
  CalendarEvent,
  ComposeAttachmentInput,
  ComposeMode,
  ComposePayload,
  ConnectionTestResult,
  Contact,
  DiagnosticsReport,
  Folder,
  Id,
  MailAddress,
  MessageDetail,
  MessageListQuery,
  MessageListResult,
  MessageSummary,
  OutboxItem,
  ProviderId,
  Rule,
  SaveAttachmentResult,
  SavedSearch,
  SearchParams,
  SearchResponse,
  SearchSuggestion,
  SendResult,
  ServerConfig,
  Signature,
  SyncStatus,
  TaskItem,
  ToastMessage,
  UpdateCheckResult,
} from './types'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K]
}

export interface OAuthStartResult {
  ok: boolean
  account?: Account
  /** id of the account that was created or re-authorised */
  accountId?: Id
  error?: string
  /** true when the user closed the browser or pressed Cancel - not an error */
  cancelled?: boolean
}

/** What the accounts screen knows about a provider's OAuth registration. */
export interface OAuthProviderStatus {
  provider: 'google' | 'microsoft'
  configured: boolean
  /** last six characters only, enough to tell two registrations apart */
  clientId: string | null
  tenant: string | null
}

export interface AutoconfigResult {
  providerId: ProviderId
  authType: 'oauth2' | 'password'
  imap: ServerConfig
  smtp: ServerConfig
  notes: string[]
  confident: boolean
}

export interface ReplyScaffoldArgs {
  messageId: Id
  mode: Exclude<ComposeMode, 'new' | 'draft'>
}

export interface ContactSuggestion {
  email: string
  name: string
  source: Contact['source']
  lastUsedAt: string | null
}

/**
 * The complete API exposed on `window.novamail` (plus a small `system` group).
 * Every method is async, every payload is validated in the main process.
 */
export interface NovaMailApi {
  app: {
    getInfo(): Promise<AppInfo>
    checkForUpdates(): Promise<UpdateCheckResult>
    openExternal(url: string): Promise<boolean>
    showItemInFolder(path: string): Promise<void>
    openLogsFolder(): Promise<void>
    openPath(path: string): Promise<boolean>
    diagnostics(): Promise<DiagnosticsReport>
    quit(): Promise<void>
    reload(): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: DeepPartial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
    chooseDownloadFolder(): Promise<string | null>
  }
  accounts: {
    list(): Promise<Account[]>
    test(input: AccountDraftInput): Promise<ConnectionTestResult>
    autoconfigure(email: string): Promise<AutoconfigResult>
    create(input: AccountDraftInput): Promise<Account>
    update(input: AccountDraftInput): Promise<Account>
    remove(id: Id): Promise<void>
    setDefault(id: Id): Promise<void>
    startOAuth(args: { provider: 'google' | 'microsoft'; loginHint?: string }): Promise<OAuthStartResult>
    revokeOAuth(accountId: Id): Promise<void>
    /** Re-authorise an existing OAuth account, selected by id. */
    reconnect(accountId: Id): Promise<OAuthStartResult>
    /** Abort a flow that is waiting for the browser. */
    cancelOAuth(): Promise<void>
    oauthStatus(): Promise<OAuthProviderStatus[]>
    setOAuthClient(args: {
      provider: 'google' | 'microsoft'
      clientId: string
      tenant?: string
    }): Promise<OAuthProviderStatus[]>
  }
  folders: {
    list(accountId?: Id): Promise<Folder[]>
    create(args: { accountId: Id; path: string }): Promise<Folder>
    rename(args: { accountId: Id; path: string; newPath: string }): Promise<void>
    remove(args: { accountId: Id; path: string }): Promise<void>
  }
  messages: {
    list(query: MessageListQuery): Promise<MessageListResult>
    get(id: Id): Promise<MessageDetail | null>
    setFlag(args: {
      ids: Id[]
      field: 'isRead' | 'isStarred' | 'isImportant'
      value: boolean
    }): Promise<void>
    archive(ids: Id[]): Promise<void>
    trash(ids: Id[]): Promise<void>
    restore(ids: Id[]): Promise<void>
    move(args: { ids: Id[]; folderId: Id }): Promise<void>
    remove(ids: Id[]): Promise<void>
    snooze(args: { ids: Id[]; until: string }): Promise<void>
    unsnooze(ids: Id[]): Promise<void>
    addLabel(args: { ids: Id[]; label: string }): Promise<void>
    removeLabel(args: { ids: Id[]; label: string }): Promise<void>
    listLabels(): Promise<{ label: string; count: number }[]>
    thread(threadId: string): Promise<MessageSummary[]>
    markFolderRead(folderId: Id): Promise<void>
    /** Explicit user consent to load remote images for one message. */
    showRemoteImages(id: Id): Promise<{ html: string; loaded: number; failed: number }>
  }
  compose: {
    saveDraft(payload: ComposePayload): Promise<Id>
    discardDraft(id: Id): Promise<void>
    send(payload: ComposePayload): Promise<SendResult>
    schedule(payload: ComposePayload, scheduledAt: string): Promise<SendResult>
    undoLast(): Promise<boolean>
    outbox(): Promise<OutboxItem[]>
    cancelOutbox(id: Id): Promise<void>
    retryOutbox(id: Id): Promise<void>
    sendOutboxNow(id: Id): Promise<void>
    buildReply(args: ReplyScaffoldArgs): Promise<ComposePayload>
    pickAttachments(): Promise<ComposeAttachmentInput[]>
    importAttachmentFromDisk(): Promise<ComposeAttachmentInput[]>
  }
  attachments: {
    list(messageId: Id): Promise<AttachmentMeta[]>
    detail(id: Id): Promise<AttachmentDetail | null>
    preview(id: Id): Promise<AttachmentPreview>
    saveAs(id: Id): Promise<SaveAttachmentResult>
    openExternally(id: Id): Promise<SaveAttachmentResult>
    print(id: Id): Promise<boolean>
    clearCache(): Promise<number>
  }
  search: {
    run(params: SearchParams): Promise<SearchResponse>
    suggestions(term: string): Promise<SearchSuggestion[]>
    saved(): Promise<SavedSearch[]>
    save(args: { name: string; query: string }): Promise<SavedSearch>
    removeSaved(id: Id): Promise<void>
    recent(): Promise<string[]>
    clearRecent(): Promise<void>
  }
  contacts: {
    list(): Promise<Contact[]>
    save(contact: Contact): Promise<Contact>
    remove(id: Id): Promise<void>
    suggest(term: string): Promise<ContactSuggestion[]>
    resolveAddresses(text: string): Promise<MailAddress[]>
  }
  calendar: {
    list(args: { from: string; to: string }): Promise<CalendarEvent[]>
    save(event: CalendarEvent): Promise<CalendarEvent>
    remove(id: Id): Promise<void>
    respond(args: { id: Id; response: CalendarEvent['myResponse'] }): Promise<void>
  }
  tasks: {
    list(): Promise<TaskItem[]>
    save(task: TaskItem): Promise<TaskItem>
    toggle(args: { id: Id; completed: boolean }): Promise<void>
    remove(id: Id): Promise<void>
  }
  rules: {
    list(): Promise<Rule[]>
    save(rule: Rule): Promise<Rule>
    remove(id: Id): Promise<void>
    runNow(): Promise<number>
    test(args: { rule: Rule; limit?: number }): Promise<number>
  }
  signatures: {
    list(): Promise<Signature[]>
    save(signature: Signature): Promise<Signature>
    remove(id: Id): Promise<void>
  }
  sync: {
    status(): Promise<SyncStatus>
    now(accountId?: Id): Promise<void>
    setOffline(offline: boolean): Promise<void>
  }
  backup: {
    exportAll(): Promise<{ ok: boolean; path?: string; cancelled?: boolean; manifest?: BackupManifest }>
    importAll(): Promise<{ ok: boolean; cancelled?: boolean; counts?: Record<string, number>; error?: string }>
  }
}

export type ApiGroup = keyof NovaMailApi
export type ApiMethod<G extends ApiGroup> = keyof NovaMailApi[G]

type MethodEntry<F> = F extends (...args: infer A) => Promise<infer R>
  ? { req: A extends [] ? void : A[0]; res: R }
  : never

export interface IpcContract {
  [key: string]: { req: unknown; res: unknown }
}

export type Channel<G extends ApiGroup = ApiGroup, M extends ApiMethod<G> = ApiMethod<G>> = `${G & string}:${M & string}`

export type ChannelRequest<G extends ApiGroup, M extends ApiMethod<G>> =
  NovaMailApi[G][M] extends (...args: infer A) => Promise<unknown> ? (A extends [] ? void : A[0]) : never

export type ChannelResponse<G extends ApiGroup, M extends ApiMethod<G>> =
  NovaMailApi[G][M] extends (...args: never[]) => Promise<infer R> ? R : never

/** Events pushed from main -> renderer. */
export interface NovaMailEvents {
  'sync:status': SyncStatus
  'messages:changed': { accountId?: Id; folderId?: Id; reason: 'new' | 'update' | 'removed' | 'refresh' }
  'folders:changed': { accountId?: Id }
  'outbox:changed': OutboxItem[]
  'settings:changed': AppSettings
  toast: ToastMessage
  navigate: { view: string; payload?: Record<string, unknown> }
  'compose:open': ComposePayload
  'oauth:result': { ok: boolean; accountId?: Id; error?: string }
  'accounts:changed': { accountId?: Id }
  'update:available': UpdateCheckResult
  'app:before-quit': void
}

export type EventName = keyof NovaMailEvents

/** What the preload script puts on window.novamail */
export interface NovaMailBridge {
  api: NovaMailApi
  /** set by the browser demo bridge only; the real preload never sets it */
  demo?: boolean
  system: {
    platform: string
    versions: { electron: string; chrome: string; node: string; app: string }
    on<E extends EventName>(event: E, listener: (payload: NovaMailEvents[E]) => void): () => void
    /** Resolves the absolute path of a dropped file (Electron removed File.path). */
    getPathForFile(file: File): string
  }
}

declare global {
  interface Window {
    novamail?: NovaMailBridge
  }
}

export const VIRTUAL_MAILBOXES = [
  'unified',
  'focused',
  'other',
  'starred',
  'important',
  'drafts',
  'sent',
  'snoozed',
  'archive',
  'spam',
  'trash',
  'outbox'
] as const

export type VirtualMailbox = (typeof VIRTUAL_MAILBOXES)[number]

export function isVirtualMailbox(value: string): value is VirtualMailbox {
  return (VIRTUAL_MAILBOXES as readonly string[]).includes(value)
}
