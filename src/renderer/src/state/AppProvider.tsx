/**
 * Novamail - renderer application state.
 *
 * A single provider owns app state so the three panes always agree: which
 * mailbox is open, what is selected, what is being read, and what the composer
 * is doing. All data still comes from the main process through the preload
 * bridge; this file only holds a view model.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  Account,
  AppInfo,
  AppSettings,
  AttachmentMeta,
  ComposePayload,
  Folder,
  MailAddress,
  MessageDetail,
  MessageSummary,
  SyncStatus,
  ToastMessage
} from '@shared/types'
import type { DeepPartial } from '@shared/ipc'
import { api, errorMessage, on } from '../bridge'

export type ViewName = 'mail' | 'contacts' | 'calendar' | 'tasks' | 'settings' | 'about' | 'rules' | 'signatures'

export interface AttachmentPreviewTarget {
  messageId: string
  attachmentId: string
  attachments: AttachmentMeta[]
}

export interface AppState {
  ready: boolean
  info: AppInfo | null
  settings: AppSettings | null
  accounts: Account[]
  folders: Folder[]
  labels: { label: string; count: number }[]
  syncStatus: SyncStatus | null
  view: ViewName
  settingsTab: string
  mailbox: string
  accountFilter: 'all' | string
  searchQuery: string
  isSearching: boolean
  messages: MessageSummary[]
  total: number
  listLoading: boolean
  listError: string | null
  selectedIds: string[]
  activeId: string | null
  detail: MessageDetail | null
  detailLoading: boolean
  compose: ComposePayload | null
  preview: AttachmentPreviewTarget | null
  toasts: ToastMessage[]
  paletteOpen: boolean
  wizardOpen: boolean
  paletteIntent: 'command' | 'search'
}

export interface AppActions {
  setView(view: ViewName, tab?: string): void
  openMailbox(mailbox: string): void
  setAccountFilter(accountId: 'all' | string): void
  refreshFolders(): Promise<void>
  refreshAccounts(): Promise<void>
  refreshLabels(): Promise<void>
  refreshList(options?: { silent?: boolean }): Promise<void>
  runSearch(query: string): Promise<void>
  clearSearch(): void
  selectMessage(id: string | null): Promise<void>
  toggleSelection(id: string): void
  selectAll(): void
  clearSelection(): void
  flag(field: 'isRead' | 'isStarred' | 'isImportant', value: boolean, ids?: string[]): Promise<void>
  archive(ids?: string[]): Promise<void>
  trash(ids?: string[]): Promise<void>
  restore(ids?: string[]): Promise<void>
  deletePermanently(ids: string[]): Promise<void>
  moveTo(folderId: string, ids?: string[]): Promise<void>
  snooze(ids: string[], until: string): Promise<void>
  unsnooze(ids: string[]): Promise<void>
  addLabel(label: string, ids?: string[]): Promise<void>
  openCompose(payload: ComposePayload | 'new' | 'reply' | 'replyAll' | 'forward'): Promise<void>
  updateCompose(patch: Partial<ComposePayload>): void
  closeCompose(): void
  sendCompose(payload: ComposePayload): Promise<boolean>
  saveDraft(payload: ComposePayload): Promise<string | null>
  openAttachment(messageId: string, attachmentId: string, attachments: AttachmentMeta[]): void
  closeAttachment(): void
  updateSettings(patch: DeepPartial<AppSettings>): Promise<void>
  pushToast(toast: Omit<ToastMessage, 'id'> & { id?: string }): void
  dismissToast(id: string): void
  setPaletteOpen(open: boolean, intent?: 'command' | 'search'): void
  setWizardOpen(open: boolean): void
  syncNow(accountId?: string): Promise<void>
  setOffline(offline: boolean): Promise<void>
}

interface AppContextValue {
  state: AppState
  actions: AppActions
}

const initialState: AppState = {
  ready: false,
  info: null,
  settings: null,
  accounts: [],
  folders: [],
  labels: [],
  syncStatus: null,
  view: 'mail',
  settingsTab: 'appearance',
  mailbox: 'unified',
  accountFilter: 'all',
  searchQuery: '',
  isSearching: false,
  messages: [],
  total: 0,
  listLoading: false,
  listError: null,
  selectedIds: [],
  activeId: null,
  detail: null,
  detailLoading: false,
  compose: null,
  preview: null,
  toasts: [],
  paletteOpen: false,
  wizardOpen: false,
  paletteIntent: 'command'
}

const AppContext = createContext<AppContextValue | null>(null)

const EMPTY_COMPOSE = (accountId: string): ComposePayload => ({
  mode: 'new',
  accountId,
  to: [],
  cc: [],
  bcc: [],
  subject: '',
  html: '',
  text: '',
  attachments: [],
  inReplyTo: null,
  references: [],
  importance: 'normal',
  requestReadReceipt: false,
  scheduledAt: null
})

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AppState>(initialState)
  const listRequest = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state

  const patch = useCallback((changes: Partial<AppState>) => {
    setState((current) => ({ ...current, ...changes }))
  }, [])

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'> & { id?: string }) => {
    const id = toast.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setState((current) => ({
      ...current,
      toasts: [...current.toasts.filter((existing) => existing.id !== id), { ...toast, id }].slice(-4)
    }))
    const duration = toast.durationMs ?? (toast.tone === 'error' ? 9000 : 5500)
    window.setTimeout(() => {
      setState((current) => ({ ...current, toasts: current.toasts.filter((existing) => existing.id !== id) }))
    }, duration)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setState((current) => ({ ...current, toasts: current.toasts.filter((toast) => toast.id !== id) }))
  }, [])

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const [info, settings, accounts, folders] = await Promise.all([
          api.app.getInfo(),
          api.settings.get(),
          api.accounts.list(),
          api.folders.list()
        ])
        if (cancelled) return
        const status = await api.sync.status().catch(() => null)
        if (cancelled) return
        setState((current) => ({
          ...current,
          ready: true,
          info,
          settings,
          accounts,
          folders,
          syncStatus: status,
          wizardOpen: accounts.length === 0
        }))
        const labels = await api.messages.listLabels().catch(() => [])
        if (!cancelled) patch({ labels })
      } catch (error) {
        if (!cancelled) {
          pushToast({ tone: 'error', title: 'Novamail could not load', description: errorMessage(error) })
          patch({ ready: true })
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [patch, pushToast])

  /* -------------------------------------------------------------- theme */

  useEffect(() => {
    if (!state.settings) return
    const { ui } = state.settings
    const root = document.documentElement
    const applyTheme = (): void => {
      const dark =
        ui.theme === 'dark' || (ui.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    applyTheme()
    root.dataset.depth = ui.neumorphicIntensity
    root.dataset.density = ui.density
    root.style.setProperty('--nm-text-scale', String(ui.textScale))
    root.style.setProperty('--nm-accent', ui.accent)
    if (ui.reduceMotion) root.dataset.motion = 'reduced'
    else delete root.dataset.motion

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (): void => applyTheme()
    if (ui.theme === 'system') media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [state.settings])

  /* -------------------------------------------------------------- events */

  const refreshListRef = useRef<(options?: { silent?: boolean }) => Promise<void>>(async () => undefined)
  const refreshFoldersRef = useRef<() => Promise<void>>(async () => undefined)
  const refreshLabelsRef = useRef<() => Promise<void>>(async () => undefined)
  const refreshAccountsRef = useRef<() => Promise<void>>(async () => undefined)
  const openComposeRef = useRef<(payload: ComposePayload | 'new') => Promise<void>>(async () => undefined)

  useEffect(() => {
    const offSync = on('sync:status', (status) => patch({ syncStatus: status }))
    const offMail = on('messages:changed', () => {
      void refreshListRef.current({ silent: true })
      void refreshFoldersRef.current()
      void refreshLabelsRef.current()
    })
    const offFolders = on('folders:changed', () => void refreshFoldersRef.current())
    const offSettings = on('settings:changed', (settings) => patch({ settings }))
    const offToast = on('toast', (toast) => pushToast(toast))
    const offNavigate = on('navigate', (payload) => {
      if (payload.view === 'settings') patch({ view: 'settings' })
      else if (payload.view === 'about') patch({ view: 'about' })
      else if (payload.view === 'mail') {
        const mailbox = payload.payload?.mailbox
        patch({
          view: 'mail',
          mailbox: typeof mailbox === 'string' ? mailbox : 'unified',
          isSearching: false,
          searchQuery: ''
        })
      }
    })
    const offCompose = on('compose:open', () => void openComposeRef.current('new'))
    const offOauth = on('oauth:result', () => {
      void refreshAccountsRef.current()
      void refreshFoldersRef.current()
    })
    // Account badges (connected / sign-in required) are refreshed for every
    // change, including a revoke that happened in this or another window.
    const offAccounts = on('accounts:changed', () => void refreshAccountsRef.current())
    return () => {
      offSync()
      offMail()
      offFolders()
      offSettings()
      offToast()
      offNavigate()
      offCompose()
      offOauth()
      offAccounts()
    }
  }, [patch, pushToast])

  /* ---------------------------------------------------------- list loading */

  const loadList = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const request = ++listRequest.current
      const snapshot = stateRef.current
      if (!options.silent) patch({ listLoading: true, listError: null })
      try {
        let messages: MessageSummary[] = []
        let total = 0
        if (snapshot.isSearching && snapshot.searchQuery.trim()) {
          const response = await api.search.run({
            q: snapshot.searchQuery,
            accountId: snapshot.accountFilter,
            limit: 200
          })
          messages = response.items
          total = response.total
        } else {
          const result = await api.messages.list({
            mailbox: snapshot.mailbox,
            accountId: snapshot.accountFilter,
            limit: 200
          })
          messages = result.items
          total = result.total
        }
        if (request !== listRequest.current) return
        patch({ messages, total, listLoading: false, listError: null })
      } catch (error) {
        if (request !== listRequest.current) return
        patch({ listLoading: false, listError: errorMessage(error) })
      }
    },
    [patch]
  )
  refreshListRef.current = loadList

  useEffect(() => {
    if (!state.ready) return
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ready, state.mailbox, state.searchQuery, state.isSearching, state.accountFilter])

  /* -------------------------------------------------------------- loaders */

  const refreshFolders = useCallback(async () => {
    try {
      patch({ folders: await api.folders.list() })
    } catch {
      /* a folder refresh must never break the UI */
    }
  }, [patch])
  refreshFoldersRef.current = refreshFolders

  const refreshAccounts = useCallback(async () => {
    try {
      const accounts = await api.accounts.list()
      patch({ accounts })
    } catch {
      /* ignore */
    }
  }, [patch])
  refreshAccountsRef.current = refreshAccounts

  const refreshLabels = useCallback(async () => {
    try {
      patch({ labels: await api.messages.listLabels() })
    } catch {
      /* ignore */
    }
  }, [patch])
  refreshLabelsRef.current = refreshLabels

  /* ------------------------------------------------------------- navigation */

  const setView = useCallback(
    (view: ViewName, tab?: string) => {
      patch({ view, ...(tab ? { settingsTab: tab } : {}) })
    },
    [patch]
  )

  const openMailbox = useCallback(
    (mailbox: string) => {
      patch({
        view: 'mail',
        mailbox,
        isSearching: false,
        searchQuery: '',
        selectedIds: [],
        activeId: null,
        detail: null
      })
    },
    [patch]
  )

  const setAccountFilter = useCallback(
    (accountId: 'all' | string) => patch({ accountFilter: accountId, selectedIds: [], activeId: null, detail: null }),
    [patch]
  )

  const runSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) {
        patch({ searchQuery: '', isSearching: false })
        return
      }
      patch({ view: 'mail', searchQuery: trimmed, isSearching: true, selectedIds: [], activeId: null, detail: null })
    },
    [patch]
  )

  const clearSearch = useCallback(() => patch({ searchQuery: '', isSearching: false }), [patch])

  /* --------------------------------------------------------------- reading */

  const selectMessage = useCallback(
    async (id: string | null) => {
      if (!id) {
        patch({ activeId: null, detail: null })
        return
      }
      const summary = stateRef.current.messages.find((message) => message.id === id)
      patch({ activeId: id, detailLoading: true })
      try {
        const detail = await api.messages.get(id)
        if (stateRef.current.activeId !== id) return
        patch({ detail, detailLoading: false })
        if (summary && !summary.isRead) {
          await api.messages.setFlag({ ids: [id], field: 'isRead', value: true }).catch(() => undefined)
          setState((current) => ({
            ...current,
            messages: current.messages.map((message) => (message.id === id ? { ...message, isRead: true } : message)),
            detail: current.detail && current.detail.id === id ? { ...current.detail, isRead: true } : current.detail
          }))
          void refreshFoldersRef.current()
        }
      } catch (error) {
        if (stateRef.current.activeId !== id) return
        patch({ detailLoading: false })
        pushToast({ tone: 'error', title: 'This message could not be opened', description: errorMessage(error) })
      }
    },
    [patch, pushToast]
  )

  const toggleSelection = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      selectedIds: current.selectedIds.includes(id)
        ? current.selectedIds.filter((existing) => existing !== id)
        : [...current.selectedIds, id]
    }))
  }, [])

  const selectAll = useCallback(() => {
    setState((current) => ({ ...current, selectedIds: current.messages.map((message) => message.id) }))
  }, [])

  const clearSelection = useCallback(() => patch({ selectedIds: [] }), [patch])

  /* ------------------------------------------------------------- mutations */

  const afterMutation = useCallback(async (removedId?: string | null) => {
    await loadList({ silent: true })
    await refreshFolders()
    if (removedId && stateRef.current.activeId === removedId) patch({ activeId: null, detail: null })
    patch({ selectedIds: [] })
  }, [loadList, patch, refreshFolders])

  const targets = useCallback((ids?: string[]) => {
    if (ids && ids.length > 0) return ids
    const current = stateRef.current
    if (current.selectedIds.length > 0) return current.selectedIds
    return current.activeId ? [current.activeId] : []
  }, [])

  const flag = useCallback(
    async (field: 'isRead' | 'isStarred' | 'isImportant', value: boolean, ids?: string[]) => {
      const list = targets(ids)
      if (list.length === 0) return
      setState((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          list.includes(message.id) ? { ...message, [field]: value } : message
        ),
        detail:
          current.detail && list.includes(current.detail.id) ? { ...current.detail, [field]: value } : current.detail
      }))
      try {
        await api.messages.setFlag({ ids: list, field, value })
        if (field === 'isRead') void refreshFoldersRef.current()
      } catch (error) {
        pushToast({ tone: 'error', title: 'The change could not be saved', description: errorMessage(error) })
        void loadList({ silent: true })
      }
    },
    [loadList, pushToast, targets]
  )

  const archive = useCallback(
    async (ids?: string[]) => {
      const list = targets(ids)
      if (list.length === 0) return
      try {
        await api.messages.archive(list)
        pushToast({
          tone: 'success',
          title: list.length === 1 ? 'Message archived' : `${list.length} messages archived`
        })
        await afterMutation(list.length === 1 ? list[0] : null)
      } catch (error) {
        pushToast({ tone: 'error', title: 'Archiving failed', description: errorMessage(error) })
      }
    },
    [afterMutation, pushToast, targets]
  )

  const trash = useCallback(
    async (ids?: string[]) => {
      const list = targets(ids)
      if (list.length === 0) return
      try {
        await api.messages.trash(list)
        pushToast({
          tone: 'success',
          title: list.length === 1 ? 'Message moved to Trash' : `${list.length} messages moved to Trash`
        })
        await afterMutation(list.length === 1 ? list[0] : null)
      } catch (error) {
        pushToast({ tone: 'error', title: 'Could not move to Trash', description: errorMessage(error) })
      }
    },
    [afterMutation, pushToast, targets]
  )

  const restore = useCallback(
    async (ids?: string[]) => {
      const list = targets(ids)
      if (list.length === 0) return
      try {
        await api.messages.restore(list)
        pushToast({ tone: 'success', title: 'Restored to the Inbox' })
        await afterMutation(list.length === 1 ? list[0] : null)
      } catch (error) {
        pushToast({ tone: 'error', title: 'Restore failed', description: errorMessage(error) })
      }
    },
    [afterMutation, pushToast, targets]
  )

  const deletePermanently = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      try {
        await api.messages.remove(ids)
        pushToast({ tone: 'success', title: ids.length === 1 ? 'Message deleted' : `${ids.length} messages deleted` })
        await afterMutation(ids.length === 1 ? ids[0] : null)
      } catch (error) {
        pushToast({ tone: 'error', title: 'Delete failed', description: errorMessage(error) })
      }
    },
    [afterMutation, pushToast]
  )

  const moveTo = useCallback(
    async (folderId: string, ids?: string[]) => {
      const list = targets(ids)
      if (list.length === 0) return
      try {
        await api.messages.move({ ids: list, folderId })
        pushToast({ tone: 'success', title: 'Moved' })
        await afterMutation(list.length === 1 ? list[0] : null)
      } catch (error) {
        pushToast({ tone: 'error', title: 'Move failed', description: errorMessage(error) })
      }
    },
    [afterMutation, pushToast, targets]
  )

  const snooze = useCallback(
    async (ids: string[], until: string) => {
      if (ids.length === 0) return
      try {
        await api.messages.snooze({ ids, until })
        pushToast({
          tone: 'success',
          title: 'Snoozed',
          description: `The message returns to your inbox on ${new Date(until).toLocaleString()}.`
        })
        await afterMutation(ids.length === 1 ? ids[0] : null)
      } catch (error) {
        pushToast({ tone: 'error', title: 'Snooze failed', description: errorMessage(error) })
      }
    },
    [afterMutation, pushToast]
  )

  const unsnooze = useCallback(
    async (ids: string[]) => {
      try {
        await api.messages.unsnooze(ids)
        await afterMutation(ids.length === 1 ? ids[0] : null)
      } catch (error) {
        pushToast({ tone: 'error', title: 'Could not wake the message', description: errorMessage(error) })
      }
    },
    [afterMutation, pushToast]
  )

  const addLabel = useCallback(
    async (label: string, ids?: string[]) => {
      const list = targets(ids)
      if (list.length === 0) return
      try {
        await api.messages.addLabel({ ids: list, label })
        await afterMutation()
        await refreshLabels()
      } catch (error) {
        pushToast({ tone: 'error', title: 'Could not add the label', description: errorMessage(error) })
      }
    },
    [afterMutation, pushToast, refreshLabels, targets]
  )

  /* ---------------------------------------------------------------- compose */

  const openCompose = useCallback(
    async (payload: ComposePayload | 'new' | 'reply' | 'replyAll' | 'forward') => {
      const current = stateRef.current
      const defaultAccountId = current.settings?.defaultAccountId ?? current.accounts[0]?.id
      if (typeof payload === 'string') {
        if (payload === 'new') {
          if (!defaultAccountId) {
            patch({ wizardOpen: true })
            return
          }
          const signatures = await api.signatures.list().catch(() => [])
          const chosen = signatures.find((entry) => entry.isDefault && entry.accountId === defaultAccountId) ?? null
          patch({
            compose: {
              ...EMPTY_COMPOSE(defaultAccountId),
              html: chosen ? `<p><br/></p><div class="nm-signature">${chosen.html}</div>` : '',
              signatureId: chosen?.id ?? null
            }
          })
          return
        }
        if (!current.activeId) {
          pushToast({ tone: 'warning', title: 'Select a message first', description: 'Choose a message to reply to.' })
          return
        }
        try {
          const scaffold = await api.compose.buildReply({ messageId: current.activeId, mode: payload })
          patch({ compose: scaffold })
        } catch (error) {
          pushToast({ tone: 'error', title: 'Could not prepare the reply', description: errorMessage(error) })
        }
        return
      }
      patch({ compose: payload })
    },
    [patch, pushToast]
  )
  openComposeRef.current = openCompose

  const updateCompose = useCallback((changes: Partial<ComposePayload>) => {
    setState((current) => (current.compose ? { ...current, compose: { ...current.compose, ...changes } } : current))
  }, [])

  const closeCompose = useCallback(() => patch({ compose: null }), [patch])

  const saveDraft = useCallback(
    async (payload: ComposePayload): Promise<string | null> => {
      try {
        const id = await api.compose.saveDraft(payload)
        setState((current) =>
          current.compose ? { ...current, compose: { ...current.compose, draftId: id } } : current
        )
        return id
      } catch (error) {
        pushToast({ tone: 'warning', title: 'Draft not saved', description: errorMessage(error) })
        return null
      }
    },
    [pushToast]
  )

  const sendCompose = useCallback(
    async (payload: ComposePayload): Promise<boolean> => {
      try {
        const result = await api.compose.send(payload)
        if (!result.ok) {
          pushToast({ tone: 'error', title: 'Message not sent', description: result.error ?? 'Please try again.' })
          return false
        }
        const undoSeconds = stateRef.current.settings?.compose.undoSendSeconds ?? 0
        if (result.scheduledFor && new Date(result.scheduledFor).getTime() - Date.now() > 1500) {
          pushToast({
            tone: 'success',
            title: 'Sending in a moment',
            description: `Undo is available for ${undoSeconds} seconds.`,
            durationMs: Math.max(4000, undoSeconds * 1000)
          })
        } else {
          pushToast({ tone: 'success', title: 'Message sent' })
        }
        patch({ compose: null })
        await loadList({ silent: true })
        return true
      } catch (error) {
        pushToast({ tone: 'error', title: 'Message not sent', description: errorMessage(error) })
        return false
      }
    },
    [loadList, patch, pushToast]
  )

  /* ------------------------------------------------------------- attachments */

  const openAttachment = useCallback(
    (messageId: string, attachmentId: string, attachments: AttachmentMeta[]) => {
      patch({ preview: { messageId, attachmentId, attachments } })
    },
    [patch]
  )

  const closeAttachment = useCallback(() => patch({ preview: null }), [patch])

  /* ---------------------------------------------------------------- settings */

  const updateSettings = useCallback(
    async (changes: DeepPartial<AppSettings>) => {
      try {
        patch({ settings: await api.settings.update(changes) })
      } catch (error) {
        pushToast({ tone: 'error', title: 'Setting not saved', description: errorMessage(error) })
      }
    },
    [patch, pushToast]
  )

  const setPaletteOpen = useCallback(
    (open: boolean, intent: 'command' | 'search' = 'command') => patch({ paletteOpen: open, paletteIntent: intent }),
    [patch]
  )

  const setWizardOpen = useCallback((open: boolean) => patch({ wizardOpen: open }), [patch])

  const syncNow = useCallback(
    async (accountId?: string) => {
      try {
        await api.sync.now(accountId)
        pushToast({ tone: 'info', title: 'Checking for new mail…' })
      } catch (error) {
        pushToast({ tone: 'error', title: 'Synchronisation failed', description: errorMessage(error) })
      }
    },
    [pushToast]
  )

  const setOffline = useCallback(
    async (offline: boolean) => {
      await api.sync.setOffline(offline)
      patch({
        syncStatus: {
          ...(stateRef.current.syncStatus ?? { globalPhase: 'idle', offline: false, queuedOperations: 0, accounts: [] }),
          offline
        }
      })
    },
    [patch]
  )

  const actions = useMemo<AppActions>(
    () => ({
      setView,
      openMailbox,
      setAccountFilter,
      refreshFolders,
      refreshAccounts,
      refreshLabels,
      refreshList: loadList,
      runSearch,
      clearSearch,
      selectMessage,
      toggleSelection,
      selectAll,
      clearSelection,
      flag,
      archive,
      trash,
      restore,
      deletePermanently,
      moveTo,
      snooze,
      unsnooze,
      addLabel,
      openCompose,
      updateCompose,
      closeCompose,
      sendCompose,
      saveDraft,
      openAttachment,
      closeAttachment,
      updateSettings,
      pushToast,
      dismissToast,
      setPaletteOpen,
      setWizardOpen,
      syncNow,
      setOffline
    }),
    [
      addLabel,
      archive,
      clearSearch,
      clearSelection,
      closeAttachment,
      closeCompose,
      deletePermanently,
      dismissToast,
      flag,
      loadList,
      moveTo,
      openAttachment,
      openCompose,
      openMailbox,
      pushToast,
      refreshAccounts,
      refreshFolders,
      refreshLabels,
      restore,
      runSearch,
      saveDraft,
      selectAll,
      selectMessage,
      sendCompose,
      setAccountFilter,
      setOffline,
      setPaletteOpen,
      setView,
      setWizardOpen,
      snooze,
      syncNow,
      toggleSelection,
      trash,
      unsnooze,
      updateCompose,
      updateSettings
    ]
  )

  const value = useMemo<AppContextValue>(() => ({ state, actions }), [state, actions])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}

/** Convenience hook for components that only need settings. */
export function useSettings(): AppSettings | null {
  return useApp().state.settings
}

export type { MailAddress, MessageDetail, MessageSummary }
