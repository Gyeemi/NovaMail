/**
 * Novamail - settings service.
 *
 * Settings are stored in the database (kv table) and mirrored to a readable
 * JSON file for backup/debugging. Defaults are chosen so a brand new user never
 * has to open the settings screen: comfortable density, 15.5px text, 100% zoom,
 * remote images blocked, conversation view on, 5 second undo send.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '@shared/types'
import type { DeepPartial } from '@shared/ipc'
import type { KvRepository } from './db/repositories/rules'
import { createLogger } from '../util/logger'

const log = createLogger('settings')
const SETTINGS_KEY = 'app-settings'

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  'compose.new': 'Ctrl+N',
  'compose.send': 'Ctrl+Enter',
  'mail.reply': 'Ctrl+R',
  'mail.replyAll': 'Ctrl+Shift+R',
  'mail.forward': 'Ctrl+Shift+F',
  'mail.archive': 'Ctrl+Shift+A',
  'mail.delete': 'Ctrl+Shift+D',
  'mail.star': 'S',
  'mail.markRead': 'M',
  'mail.markUnread': 'Shift+M',
  'navigation.search': 'Ctrl+K',
  'navigation.settings': 'Ctrl+,',
  'navigation.inbox': 'G I',
  'navigation.next': 'J',
  'navigation.previous': 'K',
  'navigation.commandPalette': 'Ctrl+Shift+P',
  'app.undo': 'Ctrl+Z',
  'app.help': 'F1'
}

export const DEFAULT_SETTINGS: AppSettings = {
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
  notifications: {
    enabled: true,
    sound: false,
    onlyImportant: false,
    desktopPreview: true,
    quietHoursStart: null,
    quietHoursEnd: null
  },
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
  sync: {
    intervalMinutes: 5,
    useIdle: true,
    downloadAttachmentsOnDemandOnly: true,
    offlineMode: false,
    maxCachedMessagesPerFolder: 2000
  },
  compose: {
    undoSendSeconds: 5,
    defaultReplyBehaviour: 'reply',
    autoSaveDraftSeconds: 20,
    sendPlainTextByDefault: false,
    signatureAboveQuote: false,
    spellcheck: true
  },
  defaultAccountId: null,
  downloadFolder: null,
  launchAtStartup: false,
  minimizeToTray: true,
  checkForUpdates: true,
  updateFeedUrl: null,
  language: 'en',
  dateFormat: 'system',
  timeFormat: 'system',
  attachmentPreview: {
    enabled: true,
    officePreviews: true,
    maxPreviewBytes: 25 * 1024 * 1024,
    autoOpenSingleAttachment: false
  },
  keyboardShortcuts: { ...DEFAULT_SHORTCUTS },
  onboardingCompleted: false
}

type Listener = (settings: AppSettings) => void

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep merge with validation of primitive types against the defaults.
 *
 * The recursion must NOT sanitise at every level: a nested object such as `ui`
 * has no `sync`/`compose` sections, so clamping it as if it were a complete
 * AppSettings would throw. Sanitising happens once, at the top level.
 */
export function mergeSettings(base: AppSettings, patch: DeepPartial<AppSettings> | Record<string, unknown>): AppSettings {
  return sanitizeSettings(mergeValues(base, patch as Record<string, unknown>) as AppSettings)
}

function mergeValues(base: unknown, patch: Record<string, unknown>): unknown {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = (base as Record<string, unknown>)[key]
    if (isPlainObject(value) && isPlainObject(current)) {
      result[key] = mergeValues(current, value)
    } else if (Array.isArray(value) && Array.isArray(current)) {
      result[key] = value
    } else if (typeof value === typeof current || current === null || current === undefined) {
      result[key] = value
    } else {
      log.warn('ignoring settings value with wrong type', { key, expected: typeof current, got: typeof value })
    }
  }
  return result
}

/** Clamps numeric ranges so a bad value can never break the UI. */
export function sanitizeSettings(settings: AppSettings): AppSettings {
  // Fill in any missing section first (an old or hand-edited settings file must
  // never leave the app without `ui` or `sync`), then clamp numeric ranges.
  const s = mergeValues(DEFAULT_SETTINGS, settings as unknown as Record<string, unknown>) as AppSettings
  s.ui.textScale = Math.min(1.4, Math.max(0.85, Number(s.ui.textScale) || 1))
  s.ui.sidebarWidth = Math.min(420, Math.max(180, Number(s.ui.sidebarWidth) || 248))
  s.ui.listWidth = Math.min(640, Math.max(280, Number(s.ui.listWidth) || 380))
  s.sync.intervalMinutes = Math.min(120, Math.max(1, Number(s.sync.intervalMinutes) || 5))
  s.compose.undoSendSeconds = Math.min(30, Math.max(0, Number(s.compose.undoSendSeconds) || 0))
  s.compose.autoSaveDraftSeconds = Math.min(300, Math.max(5, Number(s.compose.autoSaveDraftSeconds) || 20))
  s.privacy.autoDeleteTempFilesDays = Math.min(90, Math.max(0, Number(s.privacy.autoDeleteTempFilesDays) ?? 7))
  s.attachmentPreview.maxPreviewBytes = Math.min(
    100 * 1024 * 1024,
    Math.max(1024 * 1024, Number(s.attachmentPreview.maxPreviewBytes) || 25 * 1024 * 1024)
  )
  s.sync.maxCachedMessagesPerFolder = Math.min(100_000, Math.max(200, Number(s.sync.maxCachedMessagesPerFolder) || 2000))
  s.keyboardShortcuts = { ...DEFAULT_SHORTCUTS, ...(s.keyboardShortcuts ?? {}) }
  return s
}

export class SettingsService {
  private settings: AppSettings
  private readonly listeners = new Set<Listener>()

  constructor(
    private readonly kv: KvRepository,
    private readonly mirrorFile?: string
  ) {
    const stored = kv.get<Partial<AppSettings> | null>(SETTINGS_KEY, null)
    this.settings = stored ? mergeSettings(DEFAULT_SETTINGS, stored) : { ...DEFAULT_SETTINGS }
    this.mirror()
  }

  get(): AppSettings {
    return JSON.parse(JSON.stringify(this.settings)) as AppSettings
  }

  update(patch: DeepPartial<AppSettings>): AppSettings {
    this.settings = mergeSettings(this.settings, patch)
    this.kv.set(SETTINGS_KEY, this.settings)
    this.mirror()
    for (const listener of this.listeners) listener(this.get())
    return this.get()
  }

  reset(): AppSettings {
    this.settings = { ...DEFAULT_SETTINGS, keyboardShortcuts: { ...DEFAULT_SHORTCUTS } }
    this.kv.set(SETTINGS_KEY, this.settings)
    this.mirror()
    for (const listener of this.listeners) listener(this.get())
    return this.get()
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  replaceAll(settings: AppSettings): void {
    this.settings = sanitizeSettings(mergeSettings(DEFAULT_SETTINGS, settings))
    this.kv.set(SETTINGS_KEY, this.settings)
    this.mirror()
  }

  private mirror(): void {
    if (!this.mirrorFile) return
    try {
      fs.mkdirSync(path.dirname(this.mirrorFile), { recursive: true })
      fs.writeFileSync(this.mirrorFile, JSON.stringify(this.settings, null, 2))
    } catch (error) {
      log.warn('could not write settings mirror', { error })
    }
  }
}
