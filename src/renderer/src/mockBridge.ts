/**
 * Novamail - demo bridge.
 *
 * Only active when the renderer runs WITHOUT the Electron preload (for example a
 * plain browser preview during development). It never ships behaviour that the
 * packaged app relies on; the desktop build always uses the real preload API.
 * The UI shows a visible "Demo data" badge in this mode.
 */
import type { NovaMailApi, NovaMailBridge, NovaMailEvents, EventName } from '@shared/ipc'
import type {
  Account,
  AppSettings,
  AttachmentDetail,
  AttachmentMeta,
  AttachmentPreview,
  ComposePayload,
  Folder,
  MessageDetail,
  MessageSummary,
  SyncStatus
} from '@shared/types'

const now = Date.now()
const iso = (offsetMinutes: number): string => new Date(now - offsetMinutes * 60_000).toISOString()

const account: Account = {
  id: 'demo-account',
  email: 'anna@barailyinovex.example',
  displayName: 'Anna Dorji',
  providerId: 'generic',
  authType: 'password',
  oauthProvider: null,
  username: 'anna@barailyinovex.example',
  imap: { host: 'imap.barailyinovex.example', port: 993, secure: true },
  smtp: { host: 'smtp.barailyinovex.example', port: 587, secure: false },
  color: '#3f7d8c',
  isDefault: true,
  createdAt: iso(60 * 24 * 30),
  lastSyncAt: iso(3),
  syncState: 'idle',
  lastError: null,
  capabilities: {
    oauth: false,
    imap: true,
    smtp: true,
    calendar: 'none',
    contacts: 'none',
    serverSearch: true,
    idle: true,
    labels: true,
    snooze: true,
    readReceipts: true,
    deliveryReceipts: false,
    redirect: false
  },
  signatureId: null
}

const folders: Folder[] = [
  { id: 'f-inbox', accountId: account.id, path: 'INBOX', name: 'Inbox', delimiter: '/', kind: 'inbox', parentPath: null, unreadCount: 4, totalCount: 12, isVirtual: false },
  { id: 'f-drafts', accountId: account.id, path: 'Drafts', name: 'Drafts', delimiter: '/', kind: 'drafts', parentPath: null, unreadCount: 0, totalCount: 1, isVirtual: false },
  { id: 'f-sent', accountId: account.id, path: 'Sent', name: 'Sent', delimiter: '/', kind: 'sent', parentPath: null, unreadCount: 0, totalCount: 6, isVirtual: false },
  { id: 'f-archive', accountId: account.id, path: 'Archive', name: 'Archive', delimiter: '/', kind: 'archive', parentPath: null, unreadCount: 0, totalCount: 3, isVirtual: false },
  { id: 'f-spam', accountId: account.id, path: 'Spam', name: 'Spam', delimiter: '/', kind: 'spam', parentPath: null, unreadCount: 0, totalCount: 1, isVirtual: false },
  { id: 'f-trash', accountId: account.id, path: 'Trash', name: 'Trash', delimiter: '/', kind: 'trash', parentPath: null, unreadCount: 0, totalCount: 2, isVirtual: false },
  { id: 'f-projects', accountId: account.id, path: 'Projects', name: 'Projects', delimiter: '/', kind: 'folder', parentPath: null, unreadCount: 1, totalCount: 2, isVirtual: false }
]

interface DemoSeed {
  from: string
  address: string
  subject: string
  snippet: string
  minutesAgo: number
  unread?: boolean
  starred?: boolean
  important?: boolean
  attachments?: { name: string; mime: string; size: number }[]
  body: string
  labels?: string[]
}

const seeds: DemoSeed[] = [
  {
    from: 'Sonam Wangmo',
    address: 'sonam.wangmo@example.com',
    subject: 'Quarterly review: notes and next steps',
    snippet: 'Thanks for joining yesterday. I have attached the figures we walked through and a short summary of the decisions...',
    minutesAgo: 24,
    unread: true,
    starred: true,
    attachments: [
      { name: 'Q3-summary.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 184320 },
      { name: 'figures.csv', mime: 'text/csv', size: 20480 }
    ],
    labels: ['Work'],
    body: `<p>Hi Anna,</p><p>Thanks for joining yesterday. I have attached the figures we walked through and a short summary of the decisions.</p><ul><li>Keep the October launch date</li><li>Owner for the onboarding flow: Tshering</li><li>Next review on the 14th at 10:00</li></ul><p>Let me know if anything is missing.</p><p>Warm regards,<br/>Sonam</p>`
  },
  {
    from: 'Baraily Inovex Support',
    address: 'support@barailyinovex.example',
    subject: 'Your Novamail licence receipt',
    snippet: 'Thank you for choosing Novamail. Your licence is active and includes one year of updates...',
    minutesAgo: 95,
    unread: true,
    important: true,
    attachments: [{ name: 'receipt.txt', mime: 'text/plain', size: 1200 }],
    body: `<p>Thank you for choosing Novamail.</p><p>Your licence is active and includes one year of updates. Keep this receipt for your records.</p>`
  },
  {
    from: 'Kinley Drukpa',
    address: 'kinley@example.com',
    subject: 'Lunch on Friday?',
    snippet: 'Are you free around noon? There is a new place near the office that looks good.',
    minutesAgo: 180,
    unread: true,
    body: `<p>Are you free around noon? There is a new place near the office that looks good.</p><p>Let me know!</p>`
  },
  {
    from: 'Travel Desk',
    address: 'travel@example.com',
    subject: 'Itinerary for your Paro trip',
    snippet: 'Attached is the itinerary, the booking reference and the hotel address for your trip next week.',
    minutesAgo: 320,
    attachments: [{ name: 'itinerary.pdf', mime: 'application/pdf', size: 401408 }],
    labels: ['Travel'],
    body: `<p>Attached is the itinerary, the booking reference and the hotel address for your trip next week.</p><p>Safe travels.</p>`
  },
  {
    from: 'Tshering Nidup',
    address: 'tshering@example.com',
    subject: 'Re: design review checklist',
    snippet: 'Looks good to me. One suggestion: add a focus state to the segmented control before we ship.',
    minutesAgo: 600,
    starred: true,
    body: `<p>Looks good to me. One suggestion: add a focus state to the segmented control before we ship.</p><blockquote>Am I missing anything from the checklist?</blockquote>`
  },
  {
    from: 'Newsletter',
    address: 'news@designweekly.example',
    subject: 'Design Weekly #182 - accessible interfaces',
    snippet: 'This week: contrast that survives dark mode, focus order, and honest empty states.',
    minutesAgo: 1440,
    unread: true,
    body: `<p>This week: contrast that survives dark mode, focus order, and honest empty states.</p><p><a href="https://example.com">Read the full issue</a></p>`
  },
  {
    from: 'Dechen Lhamo',
    address: 'dechen@example.com',
    subject: 'Photos from the team day',
    snippet: 'A few pictures from Saturday. The group photo came out well!',
    minutesAgo: 2200,
    attachments: [{ name: 'team-day.png', mime: 'image/png', size: 240000 }],
    body: `<p>A few pictures from Saturday. The group photo came out well!</p>`
  },
  {
    from: 'IT Service Desk',
    address: 'it@example.com',
    subject: 'Scheduled maintenance on Sunday, 02:00-04:00',
    snippet: 'Mail will remain available through Novamail offline mode during the maintenance window.',
    minutesAgo: 3000,
    body: `<p>Mail will remain available through Novamail offline mode during the maintenance window.</p>`
  }
]

const messages: MessageSummary[] = seeds.map((seed, index) => ({
  id: `m-${index + 1}`,
  accountId: account.id,
  accountEmail: account.email,
  folderId: 'f-inbox',
  folderKind: 'inbox',
  threadId: `t-${index + 1}`,
  messageId: `<demo-${index + 1}@example.com>`,
  subject: seed.subject,
  from: { name: seed.from, address: seed.address },
  to: [{ name: account.displayName, address: account.email }],
  snippet: seed.snippet,
  date: iso(seed.minutesAgo),
  size: 18000 + index * 2200,
  isRead: !seed.unread,
  isStarred: Boolean(seed.starred),
  isImportant: Boolean(seed.important),
  isDraft: false,
  isSnoozed: false,
  snoozeUntil: null,
  hasAttachments: Boolean(seed.attachments?.length),
  attachmentCount: seed.attachments?.length ?? 0,
  labels: seed.labels ?? [],
  categories: [],
  hasRemoteContent: false,
  threadCount: 1,
  isFirstInThread: true,
  previewUrl: null
}))

const detailFor = (id: string): MessageDetail | null => {
  const index = Number(id.replace('m-', '')) - 1
  const seed = seeds[index]
  const summary = messages[index]
  if (!seed || !summary) return null
  return {
    ...summary,
    to: [{ name: account.displayName, address: account.email }],
    cc: [],
    bcc: [],
    replyTo: [],
    html: `<div style="font-family:'Segoe UI',sans-serif;font-size:15.5px;line-height:1.65">${seed.body}</div>`,
    text: seed.snippet,
    attachments: (seed.attachments ?? []).map((attachment, attachmentIndex) => ({
      id: `a-${index + 1}-${attachmentIndex + 1}`,
      messageId: id,
      filename: attachment.name,
      mimeType: attachment.mime,
      size: attachment.size,
      contentId: null,
      disposition: 'attachment',
      kind: 'unknown',
      isInline: false,
      checksum: null,
      cached: true
    })),
    blockedRemoteContentCount: 0,
    isEncrypted: false,
    signatureVerified: 'none',
    headers: { 'message-id': summary.messageId ?? '' },
    inReplyTo: null,
    references: [],
    listUnsubscribe: null
  }
}

const listeners = new Map<EventName, Set<(payload: unknown) => void>>()
const emit = <E extends EventName>(event: E, payload: NovaMailEvents[E]): void => {
  for (const listener of listeners.get(event) ?? []) listener(payload)
}

const settings: AppSettings = {
  ui: {
    theme: 'system',
    accent: '#3f7d8c',
    neumorphicIntensity: 'subtle',
    textScale: 1,
    density: 'comfortable',
    readingPane: 'right',
    sidebarWidth: 248,
    listWidth: 380,
    sidebarCollapsed: false,
    conversationView: true,
    experienceLevel: 'beginner',
    reduceMotion: false,
    showSnippets: true,
    navOrder: [],
    navHidden: []
  },
  notifications: { enabled: true, sound: false, onlyImportant: false, desktopPreview: true, quietHoursStart: null, quietHoursEnd: null },
  privacy: {
    blockRemoteImages: true,
    blockRemoteImagesUnknownSenders: false,
    allowReadReceipts: false,
    requestReadReceipts: false,
    warnOnExternalLinks: true,
    warnDangerousAttachments: true,
    autoDeleteTempFilesDays: 7,
    sendDeliveryReceipts: false
  },
  sync: { intervalMinutes: 5, useIdle: true, downloadAttachmentsOnDemandOnly: true, offlineMode: false, maxCachedMessagesPerFolder: 2000 },
  compose: { undoSendSeconds: 5, defaultReplyBehaviour: 'reply', autoSaveDraftSeconds: 20, sendPlainTextByDefault: false, signatureAboveQuote: false, spellcheck: true },
  defaultAccountId: account.id,
  downloadFolder: null,
  launchAtStartup: false,
  minimizeToTray: true,
  checkForUpdates: true,
  updateFeedUrl: null,
  language: 'en',
  dateFormat: 'system',
  timeFormat: 'system',
  attachmentPreview: { enabled: true, officePreviews: true, maxPreviewBytes: 26214400, autoOpenSingleAttachment: false },
  keyboardShortcuts: {},
  onboardingCompleted: true
}

export function installMockBridge(): void {
  if (typeof window === 'undefined' || window.novamail) return

  const api = {
    app: {
      getInfo: async () => ({
        name: 'Novamail',
        version: '1.0.0 (demo)',
        publisher: 'Baraily Inovex',
        tagline: 'Email, made effortless.',
        electron: '-',
        chrome: navigator.userAgent,
        node: '-',
        platform: 'browser',
        arch: '-',
        userDataPath: '(demo)',
        logPath: '(demo)',
        dataPath: '(demo)',
        isPackaged: false,
        credentialStorage: 'insecure-fallback' as const,
        buildDate: new Date().toISOString().slice(0, 10),
        license: 'Proprietary - Baraily Inovex'
      }),
      checkForUpdates: async () => ({
        configured: false,
        updateAvailable: false,
        currentVersion: '1.0.0',
        latestVersion: null,
        releaseNotes: null,
        downloadUrl: null,
        verified: false,
        message: 'Update checking is only available in the desktop app.'
      }),
      openExternal: async () => false,
      showItemInFolder: async () => undefined,
      openLogsFolder: async () => undefined,
      openPath: async () => false,
      diagnostics: async () => {
        throw new Error('Diagnostics are only available in the desktop app.')
      },
      quit: async () => undefined,
      reload: async () => undefined
    },
    settings: {
      get: async () => settings,
      update: async (patch: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(patch)) {
          const current = (settings as unknown as Record<string, unknown>)[key]
          if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object') {
            Object.assign(current, value)
          } else {
            ;(settings as unknown as Record<string, unknown>)[key] = value
          }
        }
        emit('settings:changed', settings)
        return settings
      },
      reset: async () => settings,
      chooseDownloadFolder: async () => null
    },
    accounts: {
      list: async () => [account],
      test: async () => ({ ok: false, error: 'Connections are only tested in the desktop app.' }),
      autoconfigure: async () => ({
        providerId: 'generic' as const,
        authType: 'password' as const,
        imap: { host: 'imap.example.com', port: 993, secure: true },
        smtp: { host: 'smtp.example.com', port: 587, secure: false },
        notes: ['Demo mode: settings are not saved.'],
        confident: false
      }),
      create: async () => account,
      update: async () => account,
      remove: async () => undefined,
      setDefault: async () => undefined,
      startOAuth: async () => ({ ok: false, error: 'Sign-in requires the desktop app.' }),
      revokeOAuth: async () => undefined
    },
    folders: {
      list: async () => folders,
      create: async () => folders[0]!,
      rename: async () => undefined,
      remove: async () => undefined
    },
    messages: {
      list: async (query: { mailbox: string; search?: string; limit?: number }) => {
        let items = messages
        if (query.mailbox === 'starred') items = messages.filter((m) => m.isStarred)
        else if (query.mailbox === 'drafts') items = []
        else if (query.mailbox === 'sent') items = []
        else if (query.mailbox === 'trash') items = []
        else if (query.mailbox === 'archive') items = []
        else if (query.mailbox === 'spam') items = []
        else if (query.mailbox.startsWith('folder:')) items = []
        if (query.search) {
          const needle = query.search.toLowerCase()
          items = items.filter(
            (m) =>
              m.subject.toLowerCase().includes(needle) ||
              m.from.name.toLowerCase().includes(needle) ||
              m.snippet.toLowerCase().includes(needle)
          )
        }
        return { items, total: items.length, hasMore: false }
      },
      get: async (id: string) => detailFor(id),
      setFlag: async () => undefined,
      archive: async () => undefined,
      trash: async () => undefined,
      restore: async () => undefined,
      move: async () => undefined,
      remove: async () => undefined,
      snooze: async () => undefined,
      unsnooze: async () => undefined,
      addLabel: async () => undefined,
      removeLabel: async () => undefined,
      listLabels: async () => [
        { label: 'Work', count: 4 },
        { label: 'Travel', count: 2 }
      ],
      thread: async (threadId: string) => messages.filter((m) => m.threadId === threadId),
      markFolderRead: async () => undefined,
      showRemoteImages: async () => ({ html: '', loaded: 0, failed: 0 })
    },
    compose: {
      saveDraft: async () => 'draft-1',
      discardDraft: async () => undefined,
      send: async (payload: ComposePayload) => {
        if (!payload.to.length) return { ok: false, error: 'Add at least one recipient.' }
        emit('toast', {
          id: `t-${Date.now()}`,
          tone: 'success',
          title: 'Message queued (demo)',
          description: 'Sending requires the desktop app.'
        })
        return { ok: true, outboxId: 'o-1', scheduledFor: null }
      },
      schedule: async () => ({ ok: true, outboxId: 'o-2', scheduledFor: new Date().toISOString() }),
      undoLast: async () => false,
      outbox: async () => [],
      cancelOutbox: async () => undefined,
      retryOutbox: async () => undefined,
      sendOutboxNow: async () => undefined,
      buildReply: async () => ({
        mode: 'reply' as const,
        accountId: account.id,
        to: [{ name: 'Sonam Wangmo', address: 'sonam.wangmo@example.com' }],
        cc: [],
        bcc: [],
        subject: 'Re: Quarterly review: notes and next steps',
        html: '<p></p>',
        text: '',
        attachments: [],
        inReplyTo: '<demo-1@example.com>',
        references: ['<demo-1@example.com>'],
        importance: 'normal' as const,
        requestReadReceipt: false,
        scheduledAt: null
      }),
      pickAttachments: async () => [],
      importAttachmentFromDisk: async () => []
    },
    attachments: {
      list: async (messageId: string) => detailFor(messageId)?.attachments ?? [],
      detail: async (id: string) => {
        const message = messages.find((m) => m.id === id.split('-').slice(0, 2).join('-'))
        const attachment = message ? detailFor(message.id)?.attachments.find((a) => a.id === id) : undefined
        if (!attachment) return null
        return {
          ...attachment,
          previewType: attachment.mimeType === 'text/csv' ? 'spreadsheet' : attachment.mimeType === 'text/plain' ? 'text' : 'pdf',
          safety: { level: 'safe' as const, reason: null, executable: false, macroCapable: false },
          canPreview: true,
          limitation: null
        } satisfies AttachmentDetail
      },
      preview: async (id: string): Promise<AttachmentPreview> => {
        if (id.endsWith('-2') || id.endsWith('-1')) {
          return {
            type: 'text',
            text: 'Region,Revenue,Growth\nParo,128400,12.4\nThimphu,201300,9.1\nPhuntsholing,98220,15.6\n\nNote: demo data, no attachment bytes are loaded in the browser preview.',
            truncated: false,
            lines: 6,
            language: 'plain'
          }
        }
        return {
          type: 'unsupported',
          reason: 'Attachment previews run inside the desktop app, where files are read from the secure local cache.',
          suggestion: 'Install Novamail to preview this file without downloading it.'
        }
      },
      saveAs: async () => ({ ok: false, cancelled: true }),
      openExternally: async () => ({ ok: false, error: 'Only available in the desktop app.' }),
      print: async () => false,
      clearCache: async () => 0
    },
    search: {
      run: async (params: { q: string }) => {
        const needle = params.q.toLowerCase()
        const items = messages.filter(
          (m) => m.subject.toLowerCase().includes(needle) || m.snippet.toLowerCase().includes(needle)
        )
        return { items, total: items.length, tookMs: 4, usedServerSearch: false, operatorErrors: [] }
      },
      suggestions: async () => [
        { kind: 'operator' as const, label: 'from:', value: 'from:', detail: 'sender' },
        { kind: 'operator' as const, label: 'has:attachment', value: 'has:attachment', detail: 'with files' }
      ],
      saved: async () => [],
      save: async (args: { name: string; query: string }) => ({ id: 's-1', name: args.name, query: args.query, createdAt: iso(0) }),
      removeSaved: async () => undefined,
      recent: async () => [],
      clearRecent: async () => undefined
    },
    contacts: {
      list: async () => [
        { id: 'c-1', accountId: null, displayName: 'Sonam Wangmo', emails: ['sonam.wangmo@example.com'], phone: null, company: 'Baraily Inovex', notes: null, isFavorite: true, groups: ['Work'], lastUsedAt: iso(120), source: 'collected' as const },
        { id: 'c-2', accountId: null, displayName: 'Tshering Nidup', emails: ['tshering@example.com'], phone: null, company: 'Baraily Inovex', notes: null, isFavorite: false, groups: ['Work'], lastUsedAt: iso(600), source: 'collected' as const }
      ],
      save: async (contact: unknown) => contact,
      remove: async () => undefined,
      suggest: async () => [
        { email: 'sonam.wangmo@example.com', name: 'Sonam Wangmo', source: 'collected' as const, lastUsedAt: iso(120) },
        { email: 'tshering@example.com', name: 'Tshering Nidup', source: 'collected' as const, lastUsedAt: iso(600) }
      ],
      resolveAddresses: async () => []
    },
    calendar: {
      list: async () => [
        {
          id: 'e-1',
          accountId: account.id,
          calendarName: 'Personal',
          title: 'Quarterly review',
          description: '',
          location: 'Meeting room 2',
          start: new Date(now + 3600_000).toISOString(),
          end: new Date(now + 7200_000).toISOString(),
          allDay: false,
          attendees: [],
          organizer: null,
          isRecurring: false,
          recurrenceRule: null,
          reminderMinutes: 10,
          status: 'confirmed' as const,
          myResponse: 'accepted' as const,
          source: 'local' as const
        }
      ],
      save: async (event: unknown) => event,
      remove: async () => undefined,
      respond: async () => undefined
    },
    tasks: {
      list: async () => [
        { id: 't-1', accountId: account.id, title: 'Send the October figures', notes: '', due: iso(-1440), completed: false, priority: 'high' as const, reminderAt: null, createdAt: iso(2000), finishedAt: null },
        { id: 't-2', accountId: account.id, title: 'Book the Paro hotel', notes: '', due: null, completed: true, priority: 'normal' as const, reminderAt: null, createdAt: iso(4000), finishedAt: iso(1000) }
      ],
      save: async (task: unknown) => task,
      toggle: async () => undefined,
      remove: async () => undefined
    },
    rules: {
      list: async () => [
        { id: 'r-1', accountId: null, name: 'Newsletters to reading', enabled: true, matchAll: false, conditions: [{ field: 'from' as const, operator: 'contains' as const, value: 'news@' }], actions: [{ type: 'label' as const, value: 'Reading' }], stopProcessing: false, createdAt: iso(5000), matchCount: 12 }
      ],
      save: async (rule: unknown) => rule,
      remove: async () => undefined,
      runNow: async () => 0,
      test: async () => 0
    },
    signatures: {
      list: async () => [
        { id: 'sig-1', accountId: account.id, name: 'Business', html: '<p>Anna Dorji<br/>Baraily Inovex</p>', isDefault: true }
      ],
      save: async (signature: unknown) => signature,
      remove: async () => undefined
    },
    sync: {
      status: async (): Promise<SyncStatus> => ({
        globalPhase: 'idle',
        offline: false,
        queuedOperations: 0,
        accounts: [
          {
            accountId: account.id,
            email: account.email,
            state: 'idle',
            lastSyncAt: iso(3),
            progress: null,
            lastError: null,
            pendingUploads: 0
          }
        ]
      }),
      now: async () => {
        emit('toast', { id: `s-${Date.now()}`, tone: 'info', title: 'Demo mode', description: 'Synchronisation runs in the desktop app.' })
      },
      setOffline: async () => undefined
    },
    backup: {
      exportAll: async () => ({ ok: false, cancelled: true }),
      importAll: async () => ({ ok: false, cancelled: true })
    }
  }

  const bridge: NovaMailBridge = {
    demo: true,
    api: api as unknown as NovaMailApi,
    system: {
      platform: 'browser',
      versions: { electron: '-', chrome: navigator.userAgent, node: '-', app: '1.0.0-demo' },
      on(event, listener) {
        const set = listeners.get(event) ?? new Set()
        set.add(listener as (payload: unknown) => void)
        listeners.set(event, set)
        return () => set.delete(listener as (payload: unknown) => void)
      },
      getPathForFile() {
        return ''
      }
    }
  }

  window.novamail = bridge
  window.setTimeout(() => {
    emit('sync:status', {
      globalPhase: 'idle',
      offline: false,
      queuedOperations: 0,
      accounts: [
        {
          accountId: account.id,
          email: account.email,
          state: 'idle',
          lastSyncAt: iso(3),
          progress: null,
          lastError: null,
          pendingUploads: 0
        }
      ]
    })
  }, 400)
}
