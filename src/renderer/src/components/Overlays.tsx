/**
 * Novamail - command palette and toast stack.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorMessage } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon, type IconName } from './icons'
import { IconButton, Spinner } from './ui'

export function CommandPalette(): ReactNode {
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.paletteOpen) {
      setQuery('')
      setSelected(0)
      window.setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [state.paletteOpen])

  const commands = useMemo<{ id: string; label: string; hint?: string; icon: IconName; run: () => void | Promise<void> }[]>(
    () => [
      { id: 'compose', label: 'Write a new message', hint: 'Ctrl+N', icon: 'compose', run: () => actions.openCompose('new') },
      { id: 'sync', label: 'Synchronise all accounts', hint: 'F5', icon: 'refresh', run: () => actions.syncNow() },
      { id: 'inbox', label: 'Go to the unified inbox', icon: 'inbox', run: () => actions.openMailbox('unified') },
      { id: 'starred', label: 'Go to starred messages', icon: 'star', run: () => actions.openMailbox('starred') },
      { id: 'drafts', label: 'Go to drafts', icon: 'draft', run: () => actions.openMailbox('drafts') },
      { id: 'sent', label: 'Go to sent mail', icon: 'send', run: () => actions.openMailbox('sent') },
      { id: 'archive', label: 'Go to the archive', icon: 'archive', run: () => actions.openMailbox('archive') },
      { id: 'trash', label: 'Go to the trash', icon: 'trash', run: () => actions.openMailbox('trash') },
      { id: 'contacts', label: 'Open contacts', icon: 'contacts', run: () => actions.setView('contacts') },
      { id: 'calendar', label: 'Open the calendar', icon: 'calendar', run: () => actions.setView('calendar') },
      { id: 'tasks', label: 'Open tasks', icon: 'tasks', run: () => actions.setView('tasks') },
      { id: 'rules', label: 'Manage rules and filters', icon: 'filter', run: () => actions.setView('rules') },
      { id: 'signatures', label: 'Manage signatures', icon: 'compose', run: () => actions.setView('signatures') },
      { id: 'settings', label: 'Open settings', icon: 'settings', hint: 'Ctrl+,', run: () => actions.setView('settings', 'appearance') },
      { id: 'accounts', label: 'Add or manage accounts', icon: 'user', run: () => actions.setView('settings', 'accounts') },
      {
        id: 'theme',
        label: 'Switch between light and dark',
        icon: 'moon',
        run: () => {
          const current = state.settings?.ui.theme ?? 'system'
          const next = current === 'dark' ? 'light' : 'dark'
          void actions.updateSettings({ ui: { theme: next } })
          actions.pushToast({ tone: 'info', title: `Theme: ${next}` })
        }
      },
      {
        id: 'offline',
        label: state.syncStatus?.offline ? 'Go back online' : 'Work offline',
        icon: 'offline',
        run: () => actions.setOffline(!state.syncStatus?.offline)
      },
      { id: 'about', label: 'About Novamail', icon: 'info', run: () => actions.setView('about') },
      {
        id: 'logs',
        label: 'Open the log folder',
        icon: 'folder',
        run: async () => {
          try {
            await api.app.openLogsFolder()
          } catch (error) {
            actions.pushToast({ tone: 'error', title: 'Could not open the log folder', description: errorMessage(error) })
          }
        }
      }
    ],
    [actions, state.settings?.ui.theme, state.syncStatus?.offline]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) => command.label.toLowerCase().includes(needle))
  }, [commands, query])

  if (!state.paletteOpen) return null

  const run = (command: { run: () => void | Promise<void> } | undefined): void => {
    if (!command) return
    actions.setPaletteOpen(false)
    void command.run()
  }

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && actions.setPaletteOpen(false)}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          placeholder={state.paletteIntent === 'search' ? 'Search your mail' : 'Type a command'}
          aria-label="Command"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelected((current) => Math.min(current + 1, filtered.length))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelected((current) => Math.max(current - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (selected >= filtered.length) {
                actions.setPaletteOpen(false)
                void actions.runSearch(query)
              } else run(filtered[selected])
            } else if (event.key === 'Escape') {
              actions.setPaletteOpen(false)
            }
          }}
        />
        <div className="palette__list" role="listbox" aria-label="Commands">
          {filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={index === selected}
              className="palette__item"
              onMouseEnter={() => setSelected(index)}
              onClick={() => run(command)}
            >
              <Icon name={command.icon} size={17} />
              <span style={{ flex: 1, textAlign: 'left' }}>{command.label}</span>
              {command.hint ? <kbd className="kbd">{command.hint}</kbd> : null}
            </button>
          ))}
          {query.trim() ? (
            <button
              type="button"
              role="option"
              aria-selected={selected === filtered.length}
              className="palette__item"
              onClick={() => {
                actions.setPaletteOpen(false)
                void actions.runSearch(query)
              }}
            >
              <Icon name="search" size={17} />
              <span style={{ flex: 1, textAlign: 'left' }}>Search mail for “{query.trim()}”</span>
            </button>
          ) : null}
          {filtered.length === 0 && !query.trim() ? <div className="empty-state">Nothing matches that.</div> : null}
        </div>
      </div>
    </div>
  )
}

export function ToastStack(): ReactNode {
  const { state, actions } = useApp()
  const [undoing, setUndoing] = useState<string | null>(null)

  if (state.toasts.length === 0) return null

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {state.toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <Icon
            name={toast.tone === 'success' ? 'check' : toast.tone === 'error' ? 'error' : toast.tone === 'warning' ? 'warning' : 'info'}
            size={18}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="toast__title">{toast.title}</div>
            {toast.description ? <div className="toast__desc">{toast.description}</div> : null}
            {toast.undoActionId ? (
              <button
                type="button"
                className="link-button"
                disabled={undoing === toast.id}
                onClick={async () => {
                  setUndoing(toast.id)
                  const undone = await api.compose.undoLast().catch(() => false)
                  setUndoing(null)
                  actions.dismissToast(toast.id)
                  actions.pushToast(
                    undone
                      ? { tone: 'success', title: 'Message recalled', description: 'It was not sent. Your draft is kept.' }
                      : { tone: 'warning', title: 'Too late to undo', description: 'The message has already left Novamail.' }
                  )
                }}
              >
                {undoing === toast.id ? 'Recalling…' : 'Undo send'}
              </button>
            ) : null}
          </div>
          <IconButton icon="close" label="Dismiss notification" size={13} onClick={() => actions.dismissToast(toast.id)} />
        </div>
      ))}
    </div>
  )
}

export { Spinner }
