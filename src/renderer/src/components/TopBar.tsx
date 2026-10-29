/**
 * Novamail - top application bar: brand, global search, compose, sync state,
 * notifications, settings and the account menu.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SearchSuggestion } from '@shared/types'
import { api } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon, NovamailMark } from './icons'
import { IconButton, formatRelative } from './ui'

export function TopBar(): ReactNode {
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const sync = state.syncStatus
  const syncing = sync?.globalPhase === 'syncing'
  const unread = state.folders
    .filter((folder) => folder.kind === 'inbox' && (state.accountFilter === 'all' || folder.accountId === state.accountFilter))
    .reduce((total, folder) => total + folder.unreadCount, 0)
  const defaultAccount = state.accounts.find((account) => account.id === state.settings?.defaultAccountId) ?? state.accounts[0]

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const onClickAway = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setShowSuggestions(false)
        setShowNotifications(false)
        setShowAccountMenu(false)
      }
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  useEffect(() => {
    if (!showSuggestions) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void api.search
        .suggestions(query)
        .then((result) => {
          if (!cancelled) setSuggestions(result)
        })
        .catch(() => setSuggestions([]))
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, showSuggestions])

  const submit = (value?: string): void => {
    const term = (value ?? query).trim()
    if (!term) {
      actions.clearSearch()
      return
    }
    setQuery(term)
    setShowSuggestions(false)
    void actions.runSearch(term)
  }

  return (
    <header className="topbar">
      <div className="topbar__left">
        <IconButton
          icon="menu"
          label={state.settings?.ui.sidebarCollapsed ? 'Show the sidebar' : 'Hide the sidebar'}
          onClick={() =>
            void actions.updateSettings({ ui: { sidebarCollapsed: !state.settings?.ui.sidebarCollapsed } })
          }
        />
        <div className="brand" title="Novamail — Email, made effortless.">
          <NovamailMark size={30} withBackground />
          <div className="brand__text">
            <span className="brand__name">Novamail</span>
            <span className="brand__tagline">Email, made effortless</span>
          </div>
        </div>
      </div>

      <div className="topbar__search" ref={containerRef}>
        <div className="searchbar">
          <Icon name="search" size={17} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search mail — try from:anna has:attachment larger:2mb"
            aria-label="Search mail"
            onChange={(event) => {
              setQuery(event.target.value)
              setShowSuggestions(true)
              setSelectedSuggestion(0)
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (showSuggestions && suggestions[selectedSuggestion]) {
                  const chosen = suggestions[selectedSuggestion]
                  submit(chosen.kind === 'operator' ? `${chosen.value}` : chosen.value)
                } else submit()
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelectedSuggestion((current) => Math.min(current + 1, suggestions.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelectedSuggestion((current) => Math.max(current - 1, 0))
              } else if (event.key === 'Escape') {
                setShowSuggestions(false)
              }
            }}
          />
          {query ? (
            <IconButton
              icon="close"
              label="Clear the search"
              size={14}
              onClick={() => {
                setQuery('')
                actions.clearSearch()
              }}
            />
          ) : (
            <span className="searchbar__hint" aria-hidden="true">
              Ctrl K
            </span>
          )}
        </div>

        {showSuggestions && (suggestions.length > 0 || query.length > 0) ? (
          <div className="suggestions" role="listbox" aria-label="Search suggestions">
            {suggestions.length === 0 ? (
              <div className="suggestion suggestion--muted">Press Enter to search all mail for “{query}”</div>
            ) : null}
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.kind}-${suggestion.value}-${index}`}
                type="button"
                role="option"
                aria-selected={index === selectedSuggestion}
                className="suggestion"
                onMouseEnter={() => setSelectedSuggestion(index)}
                onClick={() => submit(suggestion.kind === 'operator' ? `${suggestion.value}` : suggestion.value)}
              >
                <Icon
                  name={
                    suggestion.kind === 'contact'
                      ? 'contacts'
                      : suggestion.kind === 'folder'
                        ? 'folder'
                        : suggestion.kind === 'operator'
                          ? 'filter'
                          : suggestion.kind === 'saved'
                            ? 'star'
                            : 'search'
                  }
                  size={15}
                />
                <span className="suggestion__value">{suggestion.label || suggestion.value}</span>
                {suggestion.detail ? <span className="suggestion__desc">{suggestion.detail}</span> : null}
                {suggestion.kind === 'operator' ? <span className="suggestion__kind">operator</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="topbar__right">
        <button
          type="button"
          className="sync-pill"
          onClick={() => void actions.syncNow()}
          title={sync?.offline ? 'Working offline — click to check for new mail when online' : 'Check for new mail now'}
        >
          <span
            className={`sync-dot ${
              sync?.offline ? 'sync-dot--offline' : syncing ? 'sync-dot--syncing' : sync?.globalPhase === 'error' ? 'sync-dot--error' : ''
            }`}
          />
          <span className="sync-pill__text">
            {sync?.offline
              ? 'Offline'
              : syncing
                ? 'Checking mail…'
                : state.accounts[0]?.lastSyncAt
                  ? `Updated ${formatRelative(state.accounts[0].lastSyncAt)}`
                  : 'Not synced yet'}
          </span>
        </button>

        {state.accounts.length > 1 ? (
          <select
            className="select select--compact"
            value={state.accountFilter}
            aria-label="Show mail from"
            onChange={(event) => actions.setAccountFilter(event.target.value)}
          >
            <option value="all">All accounts</option>
            {state.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.email}
              </option>
            ))}
          </select>
        ) : null}

        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void actions.openCompose('new')}
          title="Write a new message (Ctrl+N)"
        >
          <Icon name="compose" size={17} />
          Compose
        </button>

        <div style={{ position: 'relative' }}>
          <IconButton
            icon="bell"
            label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
            onClick={() => {
              setShowNotifications((current) => !current)
              setShowAccountMenu(false)
            }}
          />
          {unread > 0 ? <span className="badge-dot" aria-hidden="true" /> : null}
          {showNotifications ? (
            <div className="popover" role="dialog" aria-label="Notifications">
              <div className="popover__header">Unread mail</div>
              {state.accounts.map((account) => {
                const count = state.folders
                  .filter((folder) => folder.kind === 'inbox' && folder.accountId === account.id)
                  .reduce((total, folder) => total + folder.unreadCount, 0)
                return (
                  <div key={account.id} className="popover__row">
                    <span className="account-dot" style={{ background: account.color }} />
                    <span className="truncate">{account.email}</span>
                    <span className="spacer" />
                    <span className="chip">{count} unread</span>
                  </div>
                )
              })}
              <div className="popover__footer">
                <button type="button" className="link-button" onClick={() => void actions.openMailbox('unified')}>
                  Open the unified inbox
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <IconButton icon="settings" label="Settings" onClick={() => actions.setView('settings', 'appearance')} />

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="avatar-button"
            onClick={() => {
              setShowAccountMenu((current) => !current)
              setShowNotifications(false)
            }}
            aria-label="Account menu"
            title={defaultAccount?.email ?? 'No account'}
          >
            {(defaultAccount?.displayName ?? 'N').slice(0, 1).toUpperCase()}
          </button>
          {showAccountMenu ? (
            <div className="popover popover--account" role="dialog" aria-label="Account menu">
              <div className="popover__header">{defaultAccount?.email ?? 'No account yet'}</div>
              {state.accounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className="popover__item"
                  onClick={() => {
                    actions.setAccountFilter(account.id)
                    setShowAccountMenu(false)
                  }}
                >
                  <span className="account-dot" style={{ background: account.color }} />
                  <span className="truncate">{account.email}</span>
                </button>
              ))}
              <div className="popover__divider" />
              <button type="button" className="popover__item" onClick={() => actions.setView('settings', 'accounts')}>
                <Icon name="user" size={16} /> Manage accounts
              </button>
              <button type="button" className="popover__item" onClick={() => actions.setPaletteOpen(true, 'command')}>
                <Icon name="command" size={16} /> Command palette
              </button>
              <button type="button" className="popover__item" onClick={() => actions.setView('about')}>
                <Icon name="info" size={16} /> About Novamail
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
