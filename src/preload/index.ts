/**
 * Novamail - preload bridge.
 *
 * The renderer gets exactly these functions, nothing else. No `require`, no
 * `fs`, no arbitrary ipcRenderer. Channel names are a fixed allow-list so the
 * renderer cannot invoke anything that is not part of the public API.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'

const API_SURFACE: Record<string, string[]> = {
  app: [
    'getInfo',
    'checkForUpdates',
    'openExternal',
    'showItemInFolder',
    'openLogsFolder',
    'openPath',
    'diagnostics',
    'quit',
    'reload'
  ],
  settings: ['get', 'update', 'reset', 'chooseDownloadFolder'],
    accounts: [
    'list',
    'test',
    'autoconfigure',
    'create',
    'update',
    'remove',
    'setDefault',
    'startOAuth',
    'revokeOAuth',
    'reconnect',
    'cancelOAuth',
    'oauthStatus',
    'setOAuthClient'
  ],
  folders: ['list', 'create', 'rename', 'remove'],
  messages: [
    'list',
    'get',
    'setFlag',
    'archive',
    'trash',
    'restore',
    'move',
    'remove',
    'snooze',
    'unsnooze',
    'addLabel',
    'removeLabel',
    'listLabels',
    'thread',
    'markFolderRead',
    'showRemoteImages'
  ],
  compose: [
    'saveDraft',
    'discardDraft',
    'send',
    'schedule',
    'undoLast',
    'outbox',
    'cancelOutbox',
    'retryOutbox',
    'sendOutboxNow',
    'buildReply',
    'pickAttachments',
    'importAttachmentFromDisk'
  ],
  attachments: ['list', 'detail', 'preview', 'saveAs', 'openExternally', 'print', 'clearCache'],
  search: ['run', 'suggestions', 'saved', 'save', 'removeSaved', 'recent', 'clearRecent'],
  contacts: ['list', 'save', 'remove', 'suggest', 'resolveAddresses'],
  calendar: ['list', 'save', 'remove', 'respond'],
  tasks: ['list', 'save', 'toggle', 'remove'],
  rules: ['list', 'save', 'remove', 'runNow', 'test'],
  signatures: ['list', 'save', 'remove'],
  sync: ['status', 'now', 'setOffline'],
  backup: ['exportAll', 'importAll']
}

const EVENTS = [
  'sync:status',
  'messages:changed',
  'folders:changed',
  'outbox:changed',
  'settings:changed',
  'toast',
  'navigate',
  'compose:open',
  'oauth:result',
  'update:available',
  'app:before-quit'
] as const

type EventName = (typeof EVENTS)[number]

const api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {}

for (const [group, methods] of Object.entries(API_SURFACE)) {
  const groupApi: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of methods) {
    const channel = `${group}:${method}`
    groupApi[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  }
  api[group] = Object.freeze(groupApi)
}

contextBridge.exposeInMainWorld('novamail', {
  api: Object.freeze(api),
  system: Object.freeze({
    platform: process.platform,
    versions: {
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      app: process.env.NOVAMAIL_VERSION ?? '1.0.0'
    },
    on(event: EventName, listener: (payload: unknown) => void): () => void {
      if (!EVENTS.includes(event)) {
        throw new Error(`Unknown event: ${event}`)
      }
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(event, wrapped)
      return () => ipcRenderer.removeListener(event, wrapped)
    },
    getPathForFile(file: File): string {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  })
})
