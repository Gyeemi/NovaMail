/**
 * Novamail - main process entry point.
 *
 * Security posture:
 *  - contextIsolation on, nodeIntegration off, sandbox on, webviewTag off
 *  - a strict Content-Security-Policy is applied to every response
 *  - navigation away from the app is blocked; links open in the system browser
 *  - a single custom protocol (novamail-att:) serves cached attachments only
 *  - permissions (camera, geolocation, ...) are denied by default
 */
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  nativeImage,
  protocol,
  safeStorage,
  session,
  shell
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { Account, MessageSummary, SyncStatus } from '@shared/types'
import { createContext } from './context'
import type { AppContext } from './context'
import { registerIpcHandlers } from './ipc'
import { configureLogger, createLogger, getLogTail } from './util/logger'
import { resolveAppPaths } from './util/paths'
import { appEvents } from './util/events'
import { contentTypeFor } from './util/mime'
import { FallbackBackend } from './services/credentials'
import type { SecretBackend } from './services/credentials'

const __dirname_ = path.dirname(fileURLToPath(import.meta.url))
const APP_VERSION = '1.0.4'
const ATTACHMENT_SCHEME = 'novamail-att'

protocol.registerSchemesAsPrivileged([
  {
    scheme: ATTACHMENT_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

const isDev = !app.isPackaged

/**
 * Static assets (window/tray icons) live in <resources>/assets when packaged and
 * in ./build during development. Resolving from the app path keeps the icons
 * working no matter which directory the process was started from.
 */
function assetPath(name: string): string {
  const packaged = path.join(process.resourcesPath ?? '', 'assets', name)
  if (fs.existsSync(packaged)) return packaged
  const dev = path.join(app.getAppPath(), 'build', name)
  if (fs.existsSync(dev)) return dev
  return packaged
}
const paths = resolveAppPaths(process.env.NOVAMAIL_DATA_DIR ?? app.getPath('userData'))
configureLogger({ dir: paths.logsDir, level: process.env.NOVAMAIL_LOG_LEVEL === 'debug' ? 'debug' : 'info' })
const log = createLogger('main')

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let tray: Tray | null = null
let context: AppContext | null = null
let quitting = false

/* --------------------------------------------------------------- credentials */

function createSecretBackend(): SecretBackend {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      kind: 'os-encrypted',
      encrypt: (plain) => {
        const buffer = safeStorage.encryptString(plain)
        return `os1:${buffer.toString('base64')}`
      },
      decrypt: (payload) => {
        const raw = payload.startsWith('os1:') ? payload.slice(4) : payload
        return safeStorage.decryptString(Buffer.from(raw, 'base64'))
      }
    }
  }
  log.warn('OS credential encryption unavailable; using the documented fallback store')
  return new FallbackBackend(path.join(paths.root, '.keystore'))
}

/* ------------------------------------------------------------------ security */

function contentSecurityPolicy(): string {
  const base = [
    "default-src 'none'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: novamail-att:",
    "font-src 'self' data:",
    "media-src novamail-att: blob: data:",
    "frame-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ]
  if (isDev) {
    // The Vite dev server needs inline scripts for hot reload and a websocket for updates.
    return base
      .map((directive) => {
        if (directive === "script-src 'self'") return "script-src 'self' 'unsafe-inline'"
        if (directive === "connect-src 'self'") return "connect-src 'self' ws://localhost:* http://localhost:*"
        return directive
      })
      .join('; ')
  }
  return base.join('; ')
}

function applySecurityHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer']
      }
    })
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['notifications', 'clipboard-sanitized-write']
    log.info('permission requested', { permission })
    callback(allowed.includes(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ['notifications', 'clipboard-sanitized-write'].includes(permission)
  )
}

/* --------------------------------------------------------------- attachment protocol */

function registerAttachmentProtocol(ctx: AppContext): void {
  protocol.handle(ATTACHMENT_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      // novamail-att://attachment/<attachmentId>
      const id = url.pathname.replace(/^\//, '').split('/')[0] ?? ''
      if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
        return new Response('Invalid attachment reference', { status: 400 })
      }
      const detail = ctx.attachmentsRepo.get(id)
      if (!detail) return new Response('Attachment not found', { status: 404 })

      const cachePath = await ctx.attachments.ensureCached(id)
      if (!ctx.attachmentCache.isInsideCache(cachePath) || !fs.existsSync(cachePath)) {
        return new Response('Attachment unavailable', { status: 404 })
      }
      const stats = fs.statSync(cachePath)
      const mime = detail.mimeType || 'application/octet-stream'
      const range = request.headers.get('range')
      const commonHeaders: Record<string, string> = {
        'content-type': mime,
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        // Attachment content must never be treated as a document that can run code.
        'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
      }

      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range)
        const start = match?.[1] ? Number(match[1]) : 0
        const end = match?.[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1
        if (start >= stats.size || start > end) {
          return new Response('Range not satisfiable', { status: 416 })
        }
        const stream = fs.createReadStream(cachePath, { start, end })
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            ...commonHeaders,
            'content-range': `bytes ${start}-${end}/${stats.size}`,
            'content-length': String(end - start + 1)
          }
        })
      }

      const stream = fs.createReadStream(cachePath)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: { ...commonHeaders, 'content-length': String(stats.size), 'content-disposition': `inline; filename="${encodeURIComponent(detail.filename)}"` }
      })
    } catch (error) {
      log.error('attachment protocol failed', { error })
      return new Response('Attachment could not be read', { status: 500 })
    }
  })
}

/* --------------------------------------------------------------- notifications */

async function showNewMailNotification(account: Account, messages: MessageSummary[]): Promise<void> {
  const settings = context?.settings.get()
  if (!settings?.notifications.enabled) return
  if (!Notification.isSupported()) return
  const [first] = messages
  if (!first) return
  if (settings.notifications.onlyImportant && !first.isImportant) return

  const title = messages.length === 1 ? `${first.from.name || first.from.address}` : `${messages.length} new messages`
  const body = settings.notifications.desktopPreview
    ? messages.length === 1
      ? first.subject
      : messages.map((message) => message.subject).slice(0, 3).join(' • ')
    : `${account.email} received new mail`

  try {
    const notification = new Notification({ title, body, silent: !settings.notifications.sound })
    notification.on('click', () => {
      focusWindow()
      appEvents.emit('navigate', { view: 'mailbox', payload: { mailbox: 'unified' } })
    })
    notification.show()
  } catch (error) {
    log.warn('notification failed', { error })
  }
}

/* ---------------------------------------------------------------------- window */

function windowStateKey(): string {
  return 'window-state'
}

function restoreWindowState(): { width: number; height: number; x?: number; y?: number; maximized: boolean } {
  const fallback = { width: 1360, height: 900, maximized: false }
  if (!context) return fallback
  const stored = context.kv.get<{
    width: number
    height: number
    x?: number
    y?: number
    maximized: boolean
  } | null>(windowStateKey(), null)
  if (!stored) return fallback
  const visible = stored.x !== undefined && stored.y !== undefined
  return { ...stored, ...(visible ? {} : { x: undefined, y: undefined }) }
}

function persistWindowState(win: BrowserWindow): void {
  if (!context) return
  const bounds = win.getNormalBounds()
  context.kv.set(windowStateKey(), { ...bounds, maximized: win.isMaximized() })
}

function createSplash(): void {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    resizable: false,
    show: true,
    center: true,
    backgroundColor: '#eef2f6',
    skipTaskbar: true,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  const html = `<!doctype html><html><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <style>
    html,body{height:100%;margin:0;font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif;
      background:linear-gradient(145deg,#f3f7fa,#e6edf2);color:#26313a;
      display:flex;align-items:center;justify-content:center;user-select:none}
    .card{text-align:center}
    .logo{width:96px;height:96px;margin:0 auto 18px;border-radius:26px;
      background:linear-gradient(145deg,#f7fafc,#e2e9ef);
      box-shadow:10px 10px 24px rgba(163,177,190,.45), -10px -10px 24px rgba(255,255,255,.95);
      display:flex;align-items:center;justify-content:center;font-size:44px;color:#3f7d8c}
    h1{font-size:26px;margin:0 0 6px;font-weight:600;letter-spacing:.2px}
    p{margin:0;color:#5c6b78;font-size:13.5px}
    .bar{width:190px;height:4px;border-radius:4px;background:#dde6ec;margin:20px auto 0;overflow:hidden}
    .bar span{display:block;height:100%;width:45%;border-radius:4px;background:#3f7d8c;
      animation:slide 1.4s ease-in-out infinite}
    @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}
  </style></head><body><div class="card">
    <div class="logo">✉</div>
    <h1>Novamail</h1>
    <p>Email, made effortless.</p>
    <div class="bar"><span></span></div>
  </div></body></html>`
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function createMainWindow(): BrowserWindow {
  const state = restoreWindowState()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#eef2f6',
    title: 'Novamail',
    autoHideMenuBar: true,
    icon: assetPath('icon.png'),
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname_, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
      devTools: isDev,
      enableWebSQL: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  })

  if (state.maximized) win.maximize()

  win.once('ready-to-show', () => {
    win.show()
    splashWindow?.close()
    splashWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void handleExternalLink(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url !== current && !url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
      void handleExternalLink(url)
    }
  })

  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  win.on('close', () => {
    if (!quitting) persistWindowState(win)
  })

  win.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname_, '../renderer/index.html'))
  }

  return win
}

async function handleExternalLink(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return
  }
  if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) {
    log.warn('blocked a link with an unsupported scheme', { protocol: url.protocol })
    return
  }
  const settings = context?.settings.get()
  if (settings?.privacy.warnOnExternalLinks) {
    const result = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Open in browser', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Open this link?',
      message: 'Novamail will open this link in your web browser.',
      detail: `${url.origin}\n\n${url.pathname.slice(0, 200)}`,
      noLink: true
    })
    if (result.response !== 0) return
  }
  await shell.openExternal(url.toString())
}

function focusWindow(): void {
  if (!mainWindow) {
    mainWindow = createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(ctx: AppContext): void {
  const iconPath = assetPath('tray.png')
  if (!fs.existsSync(iconPath)) return
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('Novamail')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Novamail', click: () => focusWindow() },
      { label: 'Sync now', click: () => void ctx.sync.syncAll() },
      { type: 'separator' },
      { label: 'Quit Novamail', click: () => app.quit() }
    ])
  )
  tray.on('click', () => focusWindow())
}

function buildMenu(ctx: AppContext): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Compose', accelerator: 'CmdOrCtrl+N', click: () => appEvents.emit('compose:open', null as never) },
        { label: 'Sync now', accelerator: 'F5', click: () => void ctx.sync.syncAll() },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Novamail' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...(isDev
          ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as Electron.MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Novamail',
          click: () => {
            focusWindow()
            appEvents.emit('navigate', { view: 'about' })
          }
        },
        { label: 'Open log folder', click: () => void shell.openPath(paths.logsDir) },
        {
          label: 'Documentation',
          click: () => void shell.openExternal('https://github.com/Gyeemi/NovaMail#readme')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ---------------------------------------------------------------------- startup */

async function bootstrap(): Promise<void> {
  log.info('starting Novamail', { version: APP_VERSION, packaged: app.isPackaged })

  const secretBackend = createSecretBackend()
  context = createContext({
    paths,
    version: APP_VERSION,
    secretBackend,
    openExternal: async (url: string) => shell.openExternal(url),
    notifier: {
      newMail: (account, messages) => {
        void showNewMailNotification(account, messages)
        appEvents.emit('toast', {
          id: `mail-${Date.now()}`,
          tone: 'info',
          title: messages.length === 1 ? 'New message' : `${messages.length} new messages`,
          description: messages[0]?.subject ?? account.email
        })
      },
      reminder: (title, body) => {
        if (Notification.isSupported()) new Notification({ title, body }).show()
      }
    },
    dataRoot: paths.root
  })

  applySecurityHeaders()
  registerAttachmentProtocol(context)
  registerIpcHandlers({ context, appVersion: APP_VERSION, isPackaged: app.isPackaged })

  appEvents.on('sync:status', (status: SyncStatus) => {
    if (!tray) return
    const unread = context?.messages.countUnread() ?? 0
    tray.setToolTip(unread > 0 ? `Novamail - ${unread} unread` : 'Novamail')
    if (status.globalPhase === 'offline') tray.setToolTip('Novamail - offline')
  })

  createSplash()
  mainWindow = createMainWindow()
  buildMenu(context)
  if (context.settings.get().minimizeToTray) createTray(context)

  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: context.settings.get().launchAtStartup })
  }

  const startedContext: AppContext = context
  startedContext.settings.onChange((settings) => {
    if (settings.minimizeToTray && !tray) createTray(startedContext)
    if (!settings.minimizeToTray && tray) {
      tray.destroy()
      tray = null
    }
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup })
  })

  context.sync.start()
  // Deliver anything that was queued while the app was closed.
  setTimeout(() => void context?.mail.processOutbox(), 3_000)
}

/* ------------------------------------------------------------------- lifecycle */

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => focusWindow())

  app.on('window-all-closed', () => {
    // Keeping a tray icon means the app should stay alive for new-mail alerts.
    // Quitting here would make "minimise to tray" silently stop notifications.
    if (process.platform !== 'darwin' && !tray) app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
  })

  app.on('before-quit', async (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    log.info('shutting down')
    try {
      await context?.close()
    } catch (error) {
      log.error('shutdown failed', { error })
    }
    app.exit(0)
  })

  process.on('uncaughtException', (error) => {
    log.error('uncaught exception', { error })
    dialog.showErrorBox(
      'Novamail ran into a problem',
      `Novamail hit an unexpected error and will close.\n\n${error.message}\n\nYour mail and settings are safe. Details were written to the log folder.`
    )
  })

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { reason })
  })

  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.barailyinovex.novamail')
      await bootstrap()
    })
    .catch((error) => {
      log.error('startup failed', { error })
      dialog.showErrorBox(
        'Novamail could not start',
        `Novamail could not start correctly.\n\n${error instanceof Error ? error.message : String(error)}\n\nLog folder: ${paths.logsDir}`
      )
      app.quit()
    })
}

export { getLogTail, contentTypeFor }
