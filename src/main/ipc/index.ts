/**
 * Novamail - IPC handlers.
 *
 * Every renderer request is validated with zod, executed against the service
 * layer, and returns a plain serialisable result. Errors are converted to safe
 * messages: stack traces, paths and credentials never reach the renderer.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ApiGroup, ApiMethod, ChannelRequest, ChannelResponse } from '@shared/ipc'
import type { AppInfo, AttachmentKind, AttachmentPreview, DiagnosticsReport } from '@shared/types'
import type { AppContext } from '../context'
import { createLogger } from '../util/logger'
import { databaseSize } from '../services/db/database'
import { attachmentUrl } from '../services/attachments/preview'
import { UpdateService } from '../services/updates'
import { safeFilename } from '@shared/attachments'
import { MIME_BY_EXTENSION } from '../util/mime'
import {
  accountDraftSchema,
  calendarEventSchema,
  composePayloadSchema,
  contactSchema,
  idSchema,
  idsSchema,
  isSafeExternalUrl,
  labelArgsSchema,
  messageListQuerySchema,
  moveArgsSchema,
  pathSchema,
  ruleSchema,
  searchParamsSchema,
  setFlagSchema,
  signatureSchema,
  snoozeArgsSchema,
  taskSchema,
  urlSchema,
  oauthClientIdSchema
} from './schemas'

const log = createLogger('ipc')

export interface IpcOptions {
  context: AppContext
  appVersion: string
  isPackaged: boolean
}

type Handler<G extends ApiGroup, M extends ApiMethod<G>> = (
  payload: ChannelRequest<G, M>,
  ...rest: unknown[]
) => Promise<ChannelResponse<G, M>>

function register<G extends ApiGroup, M extends ApiMethod<G>>(
  group: G,
  method: M,
  handler: Handler<G, M>
): void {
  const channel = `${String(group)}:${String(method)}`
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await handler(args[0] as ChannelRequest<G, M>, ...args.slice(1))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('ipc handler failed', { channel, message })
      throw new Error(safeErrorMessage(error))
    }
  })
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Something went wrong. Please try again.'
  // Never leak absolute paths or stack traces to the renderer.
  const message = error.message.replace(/[A-Za-z]:\\[^\s"']+/g, '[local path]').slice(0, 500)
  return message || 'Something went wrong. Please try again.'
}

export function registerIpcHandlers(options: IpcOptions): void {
  const { context } = options

  const appInfo = (): AppInfo => ({
    name: 'Novamail',
    version: options.appVersion,
    publisher: 'Baraily Inovex',
    tagline: 'Email, made effortless.',
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: process.platform,
    arch: process.arch,
    userDataPath: context.paths.root,
    logPath: context.paths.logsDir,
    dataPath: context.paths.databaseFile,
    isPackaged: options.isPackaged,
    credentialStorage: context.credentials.protection,
    buildDate: process.env.NOVAMAIL_BUILD_DATE ?? new Date().toISOString().slice(0, 10),
    license: 'Proprietary - Baraily Inovex'
  })

  /* ------------------------------------------------------------------- app */

  register('app', 'getInfo', async () => appInfo())

  register('app', 'checkForUpdates', async () => {
    const settings = context.settings.get()
    return new UpdateService({
      currentVersion: appInfo().version,
      feedUrl: settings.updateFeedUrl
    }).check()
  })

  register('app', 'openExternal', async (rawUrl) => {
    const url = urlSchema.parse(rawUrl)
    if (!isSafeExternalUrl(url)) {
      log.warn('blocked an unsafe external url')
      return false
    }
    await shell.openExternal(url)
    return true
  })

  register('app', 'showItemInFolder', async (target) => {
    shell.showItemInFolder(pathSchema.parse(target))
  })

  register('app', 'openLogsFolder', async () => {
    await shell.openPath(context.paths.logsDir)
  })

  register('app', 'openPath', async (target) => {
    const parsed = pathSchema.parse(target)
    const error = await shell.openPath(parsed)
    return error === ''
  })

  register('app', 'diagnostics', async (): Promise<DiagnosticsReport> => {
    const accounts = context.accounts.list()
    const counts = context.db
      .prepare('SELECT (SELECT COUNT(*) FROM messages) AS messages, (SELECT COUNT(*) FROM folders) AS folders')
      .get() as { messages: number; folders: number }
    return {
      generatedAt: new Date().toISOString(),
      app: appInfo(),
      settings: context.settings.get(),
      accounts: accounts.map((account) => ({
        id: account.id,
        email: account.email,
        providerId: account.providerId,
        syncState: account.syncState
      })),
      database: {
        path: context.paths.databaseFile,
        sizeBytes: databaseSize(context.paths.databaseFile),
        messages: counts.messages,
        folders: counts.folders
      },
      logsTail: context.logTail()
    }
  })

  register('app', 'quit', async () => {
    app.quit()
  })

  register('app', 'reload', async () => {
    BrowserWindow.getAllWindows()[0]?.reload()
  })

  /* -------------------------------------------------------------- settings */

  register('settings', 'get', async () => context.settings.get())

  register('settings', 'update', async (patch) => {
    const updated = context.settings.update(patch ?? {})
    return updated
  })

  register('settings', 'reset', async () => context.settings.reset())

  register('settings', 'chooseDownloadFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose where Novamail saves attachments',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const folder = result.filePaths[0]!
    context.settings.update({ downloadFolder: folder })
    return folder
  })

  /* -------------------------------------------------------------- accounts */

  register('accounts', 'list', async () => context.accountService.list())

  register('accounts', 'test', async (input) => {
    const parsed = accountDraftSchema.parse(input)
    return context.accountService.test(parsed)
  })

  register('accounts', 'autoconfigure', async (email) => {
    if (typeof email !== 'string') throw new Error('Enter an email address.')
    return context.accountService.autoconfigure(email)
  })

  register('accounts', 'create', async (input) => {
    const parsed = accountDraftSchema.parse(input)
    return context.accountService.create(parsed)
  })

  register('accounts', 'update', async (input) => {
    const parsed = accountDraftSchema.parse(input)
    return context.accountService.update(parsed)
  })

  register('accounts', 'remove', async (accountId) => {
    await context.accountService.remove(idSchema.parse(accountId))
  })

  register('accounts', 'setDefault', async (accountId) => {
    context.accountService.setDefault(idSchema.parse(accountId))
  })

  register('accounts', 'startOAuth', async (args) => {
    const provider = args?.provider === 'microsoft' ? 'microsoft' : 'google'
    const result = await context.accountService.startOAuth(provider, args?.loginHint)
    return result
  })

  register('accounts', 'revokeOAuth', async (accountId) => {
    await context.accountService.revokeOAuth(idSchema.parse(accountId))
  })

  register('accounts', 'reconnect', async (accountId) => {
    const id = idSchema.parse(accountId)
    const result = await context.accountService.reconnect(id)
    if (result.ok) {
      // Kick off a sync so the refreshed account proves itself immediately.
      void context.sync.syncAccount?.(id).catch(() => undefined)
    }
    return result
  })

  register('accounts', 'cancelOAuth', async () => {
    context.accountService.cancelOAuth()
  })

  register('accounts', 'oauthStatus', async () => context.accountService.oauthStatus())

  register('accounts', 'setOAuthClient', async (args) => {
    const provider = args?.provider === 'microsoft' ? 'microsoft' : 'google'
    const clientId = oauthClientIdSchema.parse(args?.clientId)
    const tenant = typeof args?.tenant === 'string' ? args.tenant.slice(0, 120) : undefined
    return context.accountService.saveOAuthClient(provider, clientId, tenant)
  })

  /* --------------------------------------------------------------- folders */

  register('folders', 'list', async (accountId) => {
    context.folders.refreshCounts(accountId)
    return context.folders.list(accountId)
  })

  register('folders', 'create', async (args) => {
    const accountId = idSchema.parse(args?.accountId)
    const folderPath = pathSchema.parse(args?.path)
    const account = context.accounts.get(accountId)
    if (!account) throw new Error('Account not found.')
    try {
      await context.sessions.withSession(accountId, async (session) => {
        await session.createFolder(folderPath)
      })
    } catch (error) {
      log.warn('server folder creation failed, kept local folder', { error })
    }
    const folder = context.folders.createLocal(accountId, folderPath)
    return folder
  })

  register('folders', 'rename', async (args) => {
    const accountId = idSchema.parse(args?.accountId)
    const current = pathSchema.parse(args?.path)
    const next = pathSchema.parse(args?.newPath)
    const folder = context.folders.findByPath(accountId, current)
    if (!folder) throw new Error('Folder not found.')
    await context.sessions.withSession(accountId, async (session) => {
      await session.renameFolder(current, next)
    })
    context.folders.rename(folder.id, next)
  })

  register('folders', 'remove', async (args) => {
    const accountId = idSchema.parse(args?.accountId)
    const current = pathSchema.parse(args?.path)
    const folder = context.folders.findByPath(accountId, current)
    if (!folder) throw new Error('Folder not found.')
    if (['inbox', 'drafts', 'sent', 'trash'].includes(folder.kind)) {
      throw new Error('This is a system folder and cannot be deleted.')
    }
    await context.sessions.withSession(accountId, async (session) => {
      await session.deleteFolder(current)
    })
    context.folders.remove(folder.id)
  })

  /* -------------------------------------------------------------- messages */

  register('messages', 'list', async (query) => {
    const parsed = messageListQuerySchema.parse(query)
    return context.mail.list(parsed)
  })

  register('messages', 'get', async (messageId) => context.mail.getDetail(idSchema.parse(messageId)))

  register('messages', 'setFlag', async (args) => {
    const parsed = setFlagSchema.parse(args)
    context.mail.setFlag(parsed.ids, parsed.field, parsed.value)
  })

  register('messages', 'archive', async (messageIds) => context.mail.archive(idsSchema.parse(messageIds)))

  register('messages', 'trash', async (messageIds) => context.mail.trash(idsSchema.parse(messageIds)))

  register('messages', 'restore', async (messageIds) => context.mail.restore(idsSchema.parse(messageIds)))

  register('messages', 'move', async (args) => {
    const parsed = moveArgsSchema.parse(args)
    context.mail.move(parsed.ids, parsed.folderId)
  })

  register('messages', 'remove', async (messageIds) => {
    await context.mail.deletePermanently(idsSchema.parse(messageIds))
  })

  register('messages', 'snooze', async (args) => {
    const parsed = snoozeArgsSchema.parse(args)
    context.mail.snooze(parsed.ids, parsed.until)
  })

  register('messages', 'unsnooze', async (messageIds) => context.mail.unsnooze(idsSchema.parse(messageIds)))

  register('messages', 'addLabel', async (args) => {
    const parsed = labelArgsSchema.parse(args)
    context.mail.addLabel(parsed.ids, parsed.label)
  })

  register('messages', 'removeLabel', async (args) => {
    const parsed = labelArgsSchema.parse(args)
    context.mail.removeLabel(parsed.ids, parsed.label)
  })

  register('messages', 'listLabels', async () => context.messages.listLabels())

  register('messages', 'thread', async (threadId) => context.mail.thread(idSchema.parse(threadId)))

  register('messages', 'markFolderRead', async (folderId) => context.mail.markFolderRead(idSchema.parse(folderId)))

  register('messages', 'showRemoteImages', async (messageId) =>
    context.mail.showRemoteImages(idSchema.parse(messageId))
  )

  /* --------------------------------------------------------------- compose */

  register('compose', 'saveDraft', async (payload) => {
    const parsed = composePayloadSchema.parse(payload)
    return context.mail.saveDraft(parsed)
  })

  register('compose', 'discardDraft', async (draftId) => {
    context.mail.discardDraft(idSchema.parse(draftId))
  })

  register('compose', 'send', async (payload) => {
    const parsed = composePayloadSchema.parse(payload)
    return context.mail.send(parsed)
  })

  register('compose', 'schedule', async (payload, scheduledAt) => {
    const parsed = composePayloadSchema.parse(payload)
    const when = z_schedule(scheduledAt)
    return context.mail.send({ ...parsed, scheduledAt: when })
  })

  register('compose', 'undoLast', async () => {
    const items = context.mail.listOutbox().filter((item) => item.status === 'queued')
    if (items.length === 0) return false
    const last = items[items.length - 1]!
    context.mail.cancelOutbox(last.id)
    return true
  })

  register('compose', 'outbox', async () => context.mail.listOutbox())

  register('compose', 'cancelOutbox', async (outboxId) => {
    context.mail.cancelOutbox(idSchema.parse(outboxId))
  })

  register('compose', 'retryOutbox', async (outboxId) => {
    context.mail.retryOutbox(idSchema.parse(outboxId))
  })

  register('compose', 'sendOutboxNow', async (outboxId) => {
    context.mail.sendOutboxNow(idSchema.parse(outboxId))
  })

  register('compose', 'buildReply', async (args) => {
    const messageId = idSchema.parse(args?.messageId)
    const mode = ['reply', 'replyAll', 'forward', 'redirect'].includes(args?.mode)
      ? (args!.mode as 'reply' | 'replyAll' | 'forward' | 'redirect')
      : 'reply'
    return context.mail.buildReply(messageId, mode)
  })

  register('compose', 'pickAttachments', async () => pickAttachments())
  register('compose', 'importAttachmentFromDisk', async () => pickAttachments())

  async function pickAttachments() {
    const result = await dialog.showOpenDialog({
      title: 'Attach files',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths.map((filePath) => {
      const stats = safeStat(filePath)
      const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stats,
        mimeType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
      }
    })
  }

  function safeStat(filePath: string): number {
    try {
      return fs.statSync(filePath).size
    } catch {
      return 0
    }
  }

  /* ----------------------------------------------------------- attachments */

  register('attachments', 'list', async (messageId) => context.attachments.list(idSchema.parse(messageId)))

  register('attachments', 'detail', async (attachmentId) => context.attachments.detail(idSchema.parse(attachmentId)))

  register('attachments', 'preview', async (attachmentId): Promise<AttachmentPreview> => {
    return context.attachments.preview(idSchema.parse(attachmentId))
  })

  register('attachments', 'saveAs', async (attachmentId) => {
    const id = idSchema.parse(attachmentId)
    const detail = context.attachments.detail(id)
    if (!detail) return { ok: false, error: 'This attachment no longer exists.' }
    const suggested = safeFilename(detail.filename)
    const defaultDir = context.settings.get().downloadFolder ?? app.getPath('downloads')
    const result = await dialog.showSaveDialog({
      title: 'Save attachment',
      defaultPath: path.join(defaultDir, suggested)
    })
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true }
    try {
      const saved = await context.attachments.exportCopy(id, result.filePath)
      return { ok: true, savedPath: saved }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'The file could not be saved.' }
    }
  })

  register('attachments', 'openExternally', async (attachmentId) => {
    const id = idSchema.parse(attachmentId)
    const detail = context.attachments.detail(id)
    if (!detail) return { ok: false, error: 'This attachment no longer exists.' }
    if (detail.safety.level === 'dangerous') {
      return {
        ok: false,
        error:
          'Novamail will not run executable files. Save the file and scan it with your antivirus if you really need to open it.'
      }
    }
    try {
      const target = await context.attachments.exportForExternalOpen(id, context.paths.tempDir)
      const error = await shell.openPath(target)
      if (error) return { ok: false, error }
      return { ok: true, savedPath: target }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'The file could not be opened.' }
    }
  })

  register('attachments', 'print', async (attachmentId) => {
    const id = idSchema.parse(attachmentId)
    const detail = context.attachments.detail(id)
    if (!detail) return false
    if (!['pdf', 'image'].includes(detail.previewType)) {
      throw new Error('Printing is only available for PDF documents and pictures.')
    }
    await context.attachments.ensureCached(id)
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: false }
    })
    try {
      await printWindow.loadURL(attachmentUrl(id))
      await new Promise<void>((resolve, reject) => {
        printWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
          if (success || failureReason === 'cancelled') resolve()
          else reject(new Error(failureReason || 'Printing failed.'))
        })
      })
      return true
    } finally {
      printWindow.destroy()
    }
  })

  register('attachments', 'clearCache', async () => context.attachments.clearCache())

  /* ---------------------------------------------------------------- search */

  register('search', 'run', async (params) => context.search.run(searchParamsSchema.parse(params)))

  register('search', 'suggestions', async (term) => context.search.suggestions(String(term ?? '').slice(0, 200)))

  register('search', 'saved', async () => context.search.saved())

  register('search', 'save', async (args) => {
    const name = String(args?.name ?? '').slice(0, 120) || 'Saved search'
    const query = String(args?.query ?? '').slice(0, 500)
    return context.search.save(name, query)
  })

  register('search', 'removeSaved', async (savedId) => context.search.removeSaved(idSchema.parse(savedId)))

  register('search', 'recent', async () => context.search.recent())

  register('search', 'clearRecent', async () => context.search.clearRecent())

  /* -------------------------------------------------------------- contacts */

  register('contacts', 'list', async () => context.contacts.list())

  register('contacts', 'save', async (contact) => context.contacts.save(contactSchema.parse(contact)))

  register('contacts', 'remove', async (contactId) => context.contacts.remove(idSchema.parse(contactId)))

  register('contacts', 'suggest', async (term) =>
    context.contacts.suggest(String(term ?? '').slice(0, 120), 10).map((contact) => ({
      email: contact.emails[0] ?? '',
      name: contact.displayName,
      source: contact.source,
      lastUsedAt: contact.lastUsedAt
    }))
  )

  register('contacts', 'resolveAddresses', async (text) => {
    const input = String(text ?? '')
    const parts = input
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean)
    return parts.map((part) => {
      const match = /^(.*?)<([^>]+)>$/.exec(part)
      if (match) return { name: match[1]!.trim(), address: match[2]!.trim() }
      return { name: '', address: part }
    })
  })

  /* -------------------------------------------------------------- calendar */

  register('calendar', 'list', async (args) => {
    const from = String(args?.from ?? new Date().toISOString())
    const to = String(args?.to ?? new Date(Date.now() + 30 * 86400000).toISOString())
    return context.calendar.list(from, to)
  })

  register('calendar', 'save', async (event) => context.calendar.save(calendarEventSchema.parse(event)))

  register('calendar', 'remove', async (eventId) => context.calendar.remove(idSchema.parse(eventId)))

  register('calendar', 'respond', async (args) => {
    const eventId = idSchema.parse(args?.id)
    const response = ['needs-action', 'accepted', 'declined', 'tentative'].includes(args?.response)
      ? (args!.response as 'needs-action' | 'accepted' | 'declined' | 'tentative')
      : 'needs-action'
    context.calendar.setResponse(eventId, response)
  })

  /* ----------------------------------------------------------------- tasks */

  register('tasks', 'list', async () => context.tasks.list())

  register('tasks', 'save', async (task) => context.tasks.save(taskSchema.parse(task)))

  register('tasks', 'toggle', async (args) => {
    context.tasks.toggle(idSchema.parse(args?.id), Boolean(args?.completed))
  })

  register('tasks', 'remove', async (taskId) => context.tasks.remove(idSchema.parse(taskId)))

  /* ----------------------------------------------------------------- rules */

  register('rules', 'list', async () => context.rules.list())

  register('rules', 'save', async (rule) => context.rules.save({ matchCount: 0, ...ruleSchema.parse(rule) }))

  register('rules', 'remove', async (ruleId) => context.rules.remove(idSchema.parse(ruleId)))

  register('rules', 'runNow', async () => {
    await context.sync.syncAll()
    return context.rules.list().reduce((sum, rule) => sum + rule.matchCount, 0)
  })

  register('rules', 'test', async (args) => {
    const rule = ruleSchema.parse(args?.rule)
    const limit = Math.min(Number(args?.limit ?? 100), 500)
    const recent = context.messages.list({ mailbox: 'unified', limit })
    let matches = 0
    for (const message of recent.items) {
      const detail = context.messages.get(message.id)
      const target = {
        accountId: message.accountId,
        accountEmail: message.accountEmail,
        fromAddress: message.from.address,
        fromName: message.from.name,
        toAddresses: detail?.to.map((t) => t.address) ?? [],
        subject: message.subject,
        body: detail?.text ?? '',
        hasAttachment: message.hasAttachments
      }
      const { matchesCondition } = await import('../services/rules/engine')
      const results = rule.conditions.map((condition) => matchesCondition(condition, target))
      const isMatch = rule.matchAll ? results.every(Boolean) : results.some(Boolean)
      if (isMatch) matches += 1
    }
    return matches
  })

  /* ------------------------------------------------------------ signatures */

  register('signatures', 'list', async () => context.signatures.list())

  register('signatures', 'save', async (signature) => context.signatures.save(signatureSchema.parse(signature)))

  register('signatures', 'remove', async (signatureId) => context.signatures.remove(idSchema.parse(signatureId)))

  /* ------------------------------------------------------------------ sync */

  register('sync', 'status', async () => context.sync.status())

  register('sync', 'now', async (accountId) => {
    if (accountId) await context.sync.syncAccount(idSchema.parse(accountId))
    else await context.sync.syncAll()
  })

  register('sync', 'setOffline', async (offline) => {
    context.sync.setOffline(Boolean(offline))
  })

  /* ---------------------------------------------------------------- backup */

  register('backup', 'exportAll', async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog({
      title: 'Create a Novamail backup',
      defaultPath: path.join(context.paths.backupsDir, `novamail-backup-${stamp}.zip`),
      filters: [{ name: 'Novamail backup', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true }
    const manifest = await context.backup.exportTo(result.filePath)
    return { ok: true, path: result.filePath, manifest }
  })

  register('backup', 'importAll', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Restore a Novamail backup',
      properties: ['openFile'],
      filters: [{ name: 'Novamail backup', extensions: ['zip'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true }
    try {
      const { counts } = await context.backup.importFrom(result.filePaths[0]!)
      return { ok: true, counts }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'The backup could not be restored.' }
    }
  })

  log.info('ipc handlers registered')
}

function z_schedule(value: unknown): string {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) throw new Error('Choose a valid date and time for scheduled sending.')
  return text
}

export type { AttachmentKind }
