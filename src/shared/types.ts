/**
 * Novamail - shared domain types.
 * Used by the main process, preload bridge and renderer. No Node/DOM APIs here.
 * Produced by Baraily Inovex.
 */

export type Id = string
export type ISODate = string

/* ------------------------------------------------------------------ settings */

export type ThemeMode = 'light' | 'dark' | 'system'
export type ReadingPanePosition = 'right' | 'bottom' | 'hidden'
export type MessageDensity = 'compact' | 'comfortable'
export type ExperienceLevel = 'beginner' | 'advanced'
export type NeumorphicIntensity = 'flat' | 'subtle' | 'premium'
export type TextScale = 0.9 | 1 | 1.15 | 1.3

export interface UISettings {
  theme: ThemeMode
  accent: string
  neumorphicIntensity: NeumorphicIntensity
  textScale: number
  density: MessageDensity
  readingPane: ReadingPanePosition
  sidebarWidth: number
  listWidth: number
  sidebarCollapsed: boolean
  conversationView: boolean
  experienceLevel: ExperienceLevel
  reduceMotion: boolean
  showSnippets: boolean
  navOrder: string[]
  navHidden: string[]
}

export interface NotificationSettings {
  enabled: boolean
  sound: boolean
  onlyImportant: boolean
  desktopPreview: boolean
  quietHoursStart: string | null
  quietHoursEnd: string | null
}

export interface PrivacySettings {
  blockRemoteImages: boolean
  blockRemoteImagesUnknownSenders: boolean
  allowReadReceipts: boolean
  requestReadReceipts: boolean
  warnOnExternalLinks: boolean
  warnDangerousAttachments: boolean
  autoDeleteTempFilesDays: number
  sendDeliveryReceipts: boolean
}

export interface SyncSettings {
  intervalMinutes: number
  useIdle: boolean
  downloadAttachmentsOnDemandOnly: boolean
  offlineMode: false | 'manual' | 'automatic'
  maxCachedMessagesPerFolder: number
}

export interface ComposeSettings {
  undoSendSeconds: number
  defaultReplyBehaviour: 'reply' | 'replyAll'
  autoSaveDraftSeconds: number
  sendPlainTextByDefault: boolean
  signatureAboveQuote: boolean
  spellcheck: boolean
}

export interface AppSettings {
  ui: UISettings
  notifications: NotificationSettings
  privacy: PrivacySettings
  sync: SyncSettings
  compose: ComposeSettings
  defaultAccountId: string | null
  downloadFolder: string | null
  launchAtStartup: boolean
  minimizeToTray: boolean
  checkForUpdates: boolean
  updateFeedUrl: string | null
  language: string
  dateFormat: 'system' | 'iso' | 'us' | 'eu'
  timeFormat: 'system' | '12h' | '24h'
  attachmentPreview: {
    enabled: boolean
    officePreviews: boolean
    maxPreviewBytes: number
    autoOpenSingleAttachment: boolean
  }
  keyboardShortcuts: Record<string, string>
  onboardingCompleted: boolean
}

/* -------------------------------------------------------------------- account */

export type ProviderId =
  | 'gmail'
  | 'microsoft365'
  | 'outlook'
  | 'icloud'
  | 'yahoo'
  | 'generic'

export type AuthType = 'oauth2' | 'password'

export interface ServerConfig {
  host: string
  port: number
  secure: boolean
}

export interface ProviderCapabilities {
  oauth: boolean
  imap: boolean
  smtp: boolean
  calendar: 'none' | 'caldav' | 'google' | 'microsoft'
  contacts: 'none' | 'carddav' | 'google' | 'microsoft'
  serverSearch: boolean
  idle: boolean
  labels: boolean
  snooze: boolean
  readReceipts: boolean
  deliveryReceipts: boolean
  redirect: boolean
}

export type AccountSyncState = 'idle' | 'syncing' | 'error' | 'offline' | 'auth-required'

export interface Account {
  id: Id
  email: string
  displayName: string
  providerId: ProviderId
  authType: AuthType
  oauthProvider: 'google' | 'microsoft' | null
  username: string
  imap: ServerConfig
  smtp: ServerConfig
  color: string
  isDefault: boolean
  createdAt: ISODate
  lastSyncAt: ISODate | null
  syncState: AccountSyncState
  lastError: string | null
  capabilities: ProviderCapabilities
  signatureId: Id | null
}

export interface AccountDraftInput {
  id?: Id
  email: string
  displayName: string
  providerId: ProviderId
  authType: AuthType
  username: string
  imap: ServerConfig
  smtp: ServerConfig
  /** Only sent over IPC when creating/updating a password account. Never persisted in plaintext. */
  password?: string
  oauthProvider?: 'google' | 'microsoft' | null
  color?: string
}

export interface ConnectionTestResult {
  ok: boolean
  imap?: { ok: boolean; message: string; folders?: number }
  smtp?: { ok: boolean; message: string }
  autoconfig?: { found: boolean; source: string }
  error?: string
}

/* --------------------------------------------------------------------- folder */

export type FolderKind =
  | 'inbox'
  | 'drafts'
  | 'sent'
  | 'archive'
  | 'spam'
  | 'trash'
  | 'outbox'
  | 'folder'

export interface Folder {
  id: Id
  accountId: Id
  path: string
  name: string
  delimiter: string
  kind: FolderKind
  parentPath: string | null
  unreadCount: number
  totalCount: number
  isVirtual: boolean
}

/* -------------------------------------------------------------------- message */

export interface MailAddress {
  name: string
  address: string
}

export type MessageFlagField = 'isRead' | 'isStarred' | 'isImportant' | 'isSnoozed'

export interface MessageSummary {
  id: Id
  accountId: Id
  accountEmail: string
  folderId: Id
  folderKind: FolderKind
  threadId: string
  messageId: string | null
  subject: string
  from: MailAddress
  to: MailAddress[]
  snippet: string
  date: ISODate
  size: number
  isRead: boolean
  isStarred: boolean
  isImportant: boolean
  isDraft: boolean
  isSnoozed: boolean
  snoozeUntil: ISODate | null
  hasAttachments: boolean
  attachmentCount: number
  labels: string[]
  categories: string[]
  hasRemoteContent: boolean
  threadCount?: number
  isFirstInThread?: boolean
  previewUrl: string | null
}

export interface AttachmentMeta {
  id: Id
  messageId: Id
  filename: string
  mimeType: string
  size: number
  contentId: string | null
  disposition: 'attachment' | 'inline'
  kind: AttachmentKind
  isInline: boolean
  checksum: string | null
  /** true when bytes are already in the local attachment cache. */
  cached: boolean
}

export interface MessageDetail extends MessageSummary {
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  replyTo: MailAddress[]
  /** Sanitised HTML, remote content already blocked/rewritten per settings. */
  html: string | null
  text: string | null
  attachments: AttachmentMeta[]
  labels: string[]
  blockedRemoteContentCount: number
  isEncrypted: boolean
  signatureVerified: 'none' | 'unknown'
  headers: Record<string, string>
  inReplyTo: string | null
  references: string[]
  listUnsubscribe: string | null
}

export interface MessageListQuery {
  /** mailbox key: folder id, or one of the virtual keys below. */
  mailbox: string
  accountId?: Id | 'all'
  sort?: 'date' | 'sender' | 'subject' | 'size'
  direction?: 'asc' | 'desc'
  limit?: number
  offset?: number
  unreadOnly?: boolean
  starredOnly?: boolean
  attachmentsOnly?: boolean
  focusedOnly?: boolean
  otherOnly?: boolean
  search?: string
  label?: string
  fromFilter?: string
  toFilter?: string
  subjectFilter?: string
  filenameFilter?: string
  minSize?: number
  fromDate?: ISODate
  toDate?: ISODate
  includeSnoozed?: boolean
  /** include trash and spam in the result set (search does, normal views do not) */
  includeDeleted?: boolean
}

export interface MessageListResult {
  items: MessageSummary[]
  total: number
  hasMore: boolean
}

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward' | 'redirect' | 'draft'

export interface ComposeAttachmentInput {
  /** absolute path chosen by the user through the native dialog or drag & drop */
  path: string
  name: string
  size: number
  mimeType: string
  isInline?: boolean
  contentId?: string
}

export interface ComposePayload {
  mode: ComposeMode
  draftId?: Id
  accountId: Id
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  html: string
  text: string
  attachments: ComposeAttachmentInput[]
  inReplyTo: string | null
  references: string[]
  importance: 'low' | 'normal' | 'high'
  requestReadReceipt: boolean
  redirectTo?: MailAddress | null
  scheduledAt?: ISODate | null
  signatureId?: Id | null
}

export interface SendResult {
  ok: boolean
  outboxId?: Id
  messageId?: Id
  error?: string
  scheduledFor?: ISODate | null
}

export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'

export interface OutboxItem {
  id: Id
  accountId: Id
  accountEmail: string
  subject: string
  recipients: string[]
  status: OutboxStatus
  attempts: number
  lastError: string | null
  scheduledAt: ISODate | null
  createdAt: ISODate
  sentAt: ISODate | null
  undoable: boolean
}

/* ---------------------------------------------------------------- attachments */

export type AttachmentKind =
  | 'pdf'
  | 'image'
  | 'text'
  | 'csv'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'audio'
  | 'video'
  | 'archive'
  | 'email'
  | 'calendar'
  | 'contact'
  | 'unknown'

export type PreviewType =
  | 'pdf'
  | 'image'
  | 'text'
  | 'html'
  | 'spreadsheet'
  | 'slides'
  | 'audio'
  | 'video'
  | 'email'
  | 'unsupported'

export interface AttachmentSafety {
  level: 'safe' | 'caution' | 'dangerous'
  reason: string | null
  executable: boolean
  macroCapable: boolean
}

export interface AttachmentDetail extends AttachmentMeta {
  previewType: PreviewType
  safety: AttachmentSafety
  canPreview: boolean
  limitation: string | null
}

export interface TextPreview {
  type: 'text'
  text: string
  truncated: boolean
  lines: number
  language: string
}

export interface HtmlPreview {
  type: 'html' | 'email'
  html: string
  warnings: string[]
}

export interface SpreadsheetPreview {
  type: 'spreadsheet'
  sheets: {
    name: string
    rows: string[][]
    truncatedRows: boolean
    truncatedCols: boolean
  }[]
  warnings: string[]
}

export interface SlidesPreview {
  type: 'slides'
  slides: { index: number; title: string; lines: string[]; imageDataUrls: string[] }[]
  warnings: string[]
}

export interface MediaPreview {
  type: 'audio' | 'video' | 'image' | 'pdf'
  url: string
  mimeType: string
}

export interface UnsupportedPreview {
  type: 'unsupported'
  reason: string
  suggestion: string
}

export type AttachmentPreview =
  | TextPreview
  | HtmlPreview
  | SpreadsheetPreview
  | SlidesPreview
  | MediaPreview
  | UnsupportedPreview

export interface SaveAttachmentResult {
  ok: boolean
  savedPath?: string
  cancelled?: boolean
  error?: string
}

/* --------------------------------------------------------------- productivity */

export interface Contact {
  id: Id
  accountId: Id | null
  displayName: string
  emails: string[]
  phone: string | null
  company: string | null
  notes: string | null
  isFavorite: boolean
  groups: string[]
  lastUsedAt: ISODate | null
  source: 'local' | 'collected' | 'google' | 'microsoft' | 'carddav'
}

export type AttendeeRole = 'organizer' | 'required' | 'optional'

export interface Attendee {
  email: string
  name: string
  role: AttendeeRole
  status: 'needs-action' | 'accepted' | 'declined' | 'tentative' | 'delegated'
}

export interface CalendarEvent {
  id: Id
  accountId: Id | null
  calendarName: string
  title: string
  description: string
  location: string
  start: ISODate
  end: ISODate
  allDay: boolean
  attendees: Attendee[]
  organizer: string | null
  isRecurring: boolean
  recurrenceRule: string | null
  reminderMinutes: number | null
  status: 'confirmed' | 'tentative' | 'cancelled'
  myResponse: 'needs-action' | 'accepted' | 'declined' | 'tentative'
  source: 'local' | 'imip' | 'google' | 'microsoft'
}

export interface TaskItem {
  id: Id
  accountId: Id | null
  title: string
  notes: string
  due: ISODate | null
  completed: boolean
  priority: 'low' | 'normal' | 'high'
  reminderAt: ISODate | null
  createdAt: ISODate
  finishedAt: ISODate | null
}

/* --------------------------------------------------------------------- rules */

export type RuleField =
  | 'from'
  | 'to'
  | 'subject'
  | 'body'
  | 'hasAttachment'
  | 'account'

export type RuleOperator = 'contains' | 'notContains' | 'equals' | 'matches' | 'is'

export interface RuleCondition {
  field: RuleField
  operator: RuleOperator
  value: string
}

export type RuleActionType =
  | 'move'
  | 'label'
  | 'markRead'
  | 'star'
  | 'delete'
  | 'forward'

export interface RuleAction {
  type: RuleActionType
  value: string
}

export interface Rule {
  id: Id
  accountId: Id | null
  name: string
  enabled: boolean
  matchAll: boolean
  conditions: RuleCondition[]
  actions: RuleAction[]
  stopProcessing: boolean
  createdAt: ISODate
  matchCount: number
}

export interface Signature {
  id: Id
  accountId: Id | null
  name: string
  html: string
  isDefault: boolean
}

/* -------------------------------------------------------------------- search */

export interface SearchParams {
  q: string
  accountId?: Id | 'all'
  mailbox?: string
  from?: string
  to?: string
  subject?: string
  hasAttachment?: boolean
  afterDate?: string
  beforeDate?: string
  unreadOnly?: boolean
  starredOnly?: boolean
  limit?: number
  offset?: number
}

export interface SavedSearch {
  id: Id
  name: string
  query: string
  createdAt: ISODate
}

export interface SearchSuggestion {
  kind: 'operator' | 'contact' | 'recent' | 'saved' | 'folder' | 'text'
  label: string
  value: string
  detail?: string
}

export interface SearchResponse {
  items: MessageSummary[]
  total: number
  tookMs: number
  usedServerSearch: boolean
  operatorErrors: string[]
}

/* ---------------------------------------------------------------------- sync */

export interface SyncStatus {
  globalPhase: 'idle' | 'syncing' | 'offline' | 'error'
  offline: boolean
  queuedOperations: number
  accounts: {
    accountId: Id
    email: string
    state: AccountSyncState
    lastSyncAt: ISODate | null
    progress: { folder: string; current: number; total: number } | null
    lastError: string | null
    pendingUploads: number
  }[]
}

export interface AppInfo {
  name: string
  version: string
  publisher: string
  tagline: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  userDataPath: string
  logPath: string
  dataPath: string
  isPackaged: boolean
  credentialStorage: 'os-encrypted' | 'insecure-fallback'
  buildDate: string
  license: string
}

export interface UpdateCheckResult {
  configured: boolean
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string | null
  releaseNotes: string | null
  downloadUrl: string | null
  verified: boolean
  message: string
}

/* ------------------------------------------------------------------ app misc */

export interface ToastMessage {
  id: string
  tone: 'info' | 'success' | 'warning' | 'error'
  title: string
  description?: string
  durationMs?: number
  undoActionId?: string
}

export interface DiagnosticsReport {
  generatedAt: ISODate
  app: AppInfo
  settings: AppSettings
  accounts: { id: Id; email: string; providerId: ProviderId; syncState: AccountSyncState }[]
  database: { path: string; sizeBytes: number; messages: number; folders: number }
  logsTail: string[]
}

export interface BackupManifest {
  version: number
  createdAt: ISODate
  appVersion: string
  includesPasswords: false
  counts: Record<string, number>
}
