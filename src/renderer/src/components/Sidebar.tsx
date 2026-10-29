/**
 * Novamail - navigation sidebar.
 *
 * Sections can be reordered and hidden; the choice is stored in settings so it
 * survives restarts and upgrades. Unread counts come from the database, never
 * from guesswork.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { Folder } from '@shared/types'
import { api, errorMessage } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon, type IconName } from './icons'
import { Button, IconButton, Modal } from './ui'

interface NavDefinition {
  key: string
  label: string
  icon: IconName
  mailbox?: string
  view?: 'contacts' | 'calendar' | 'tasks' | 'settings'
  count?: number
  tone?: 'danger'
}

const DEFAULT_ORDER = [
  'unified',
  'focused',
  'other',
  'starred',
  'important',
  'snoozed',
  'drafts',
  'sent',
  'archive',
  'spam',
  'trash',
  'folders',
  'labels',
  'accounts',
  'contacts',
  'calendar',
  'tasks'
]

const LABELS: Record<string, string> = {
  unified: 'Unified inbox',
  focused: 'Focused',
  other: 'Other',
  starred: 'Starred',
  important: 'Important',
  snoozed: 'Snoozed',
  drafts: 'Drafts',
  sent: 'Sent',
  archive: 'Archive',
  spam: 'Spam',
  trash: 'Trash',
  folders: 'Custom folders',
  labels: 'Labels',
  accounts: 'Accounts',
  contacts: 'Contacts',
  calendar: 'Calendar',
  tasks: 'Tasks'
}

export function Sidebar(): ReactNode {
  const { state, actions } = useApp()
  const [customizing, setCustomizing] = useState(false)

  const settings = state.settings
  const order = settings?.ui.navOrder?.length ? settings.ui.navOrder : DEFAULT_ORDER
  const hidden = settings?.ui.navHidden ?? []

  const counts = useMemo(() => {
    const inbox = state.folders.filter((folder) => folder.kind === 'inbox')
    const unread = inbox.reduce((total, folder) => total + folder.unreadCount, 0)
    const byKind = (kind: Folder['kind']): number =>
      state.folders.filter((folder) => folder.kind === kind).reduce((total, folder) => total + folder.totalCount, 0)
    return {
      unified: unread,
      drafts: byKind('drafts'),
      sent: byKind('sent'),
      archive: byKind('archive'),
      spam: state.folders.filter((folder) => folder.kind === 'spam').reduce((total, folder) => total + folder.unreadCount, 0),
      trash: byKind('trash')
    }
  }, [state.folders])

  const definitions = useMemo<Record<string, NavDefinition>>(
    () => ({
      unified: { key: 'unified', label: LABELS.unified!, icon: 'inbox', mailbox: 'unified', count: counts.unified },
      focused: { key: 'focused', label: LABELS.focused!, icon: 'star', mailbox: 'focused' },
      other: { key: 'other', label: LABELS.other!, icon: 'folder', mailbox: 'other' },
      starred: { key: 'starred', label: LABELS.starred!, icon: 'star', mailbox: 'starred' },
      important: { key: 'important', label: LABELS.important!, icon: 'important', mailbox: 'important' },
      snoozed: { key: 'snoozed', label: LABELS.snoozed!, icon: 'snooze', mailbox: 'snoozed' },
      drafts: { key: 'drafts', label: LABELS.drafts!, icon: 'draft', mailbox: 'drafts', count: counts.drafts },
      sent: { key: 'sent', label: LABELS.sent!, icon: 'send', mailbox: 'sent' },
      archive: { key: 'archive', label: LABELS.archive!, icon: 'archive', mailbox: 'archive' },
      spam: { key: 'spam', label: LABELS.spam!, icon: 'spam', mailbox: 'spam', count: counts.spam },
      trash: { key: 'trash', label: LABELS.trash!, icon: 'trash', mailbox: 'trash' },
      accounts: { key: 'accounts', label: LABELS.accounts!, icon: 'user' },
      contacts: { key: 'contacts', label: LABELS.contacts!, icon: 'contacts', view: 'contacts' },
      calendar: { key: 'calendar', label: LABELS.calendar!, icon: 'calendar', view: 'calendar' },
      tasks: { key: 'tasks', label: LABELS.tasks!, icon: 'tasks', view: 'tasks' }
    }),
    [counts]
  )

  const visible = order.filter((key) => !hidden.includes(key))
  const mailKeys = visible.filter((key) => definitions[key])
  const showFolders = !hidden.includes('folders')
  const showLabels = !hidden.includes('labels') && state.labels.length > 0

  const customFolders = state.folders.filter(
    (folder) => folder.kind === 'folder' && (state.accountFilter === 'all' || folder.accountId === state.accountFilter)
  )

  const isActive = (definition: NavDefinition): boolean => {
    if (definition.view) return state.view === definition.view
    return state.view === 'mail' && state.mailbox === definition.mailbox
  }

  const open = (definition: NavDefinition): void => {
    if (definition.view) actions.setView(definition.view)
    else if (definition.mailbox) actions.openMailbox(definition.mailbox)
  }

  const createFolder = async (): Promise<void> => {
    const accountId = state.accountFilter !== 'all' ? state.accountFilter : state.accounts[0]?.id
    if (!accountId) {
      actions.pushToast({ tone: 'warning', title: 'Add an account first' })
      return
    }
    const name = window.prompt('New folder name')
    if (!name?.trim()) return
    try {
      await api.folders.create({ accountId, path: name.trim() })
      await actions.refreshFolders()
      actions.pushToast({ tone: 'success', title: 'Folder created', description: name.trim() })
    } catch (error) {
      actions.pushToast({ tone: 'error', title: 'The folder could not be created', description: errorMessage(error) })
    }
  }

  return (
    <nav className="sidebar" aria-label="Mailbox navigation">
      <div className="sidebar__scroll">
        <div className="nav-section">
          {mailKeys
            .filter((key) => key !== 'contacts' && key !== 'calendar' && key !== 'tasks' && key !== 'accounts')
            .map((key) => {
              const definition = definitions[key]!
              return (
                <button
                  key={key}
                  type="button"
                  className={`nav-item ${isActive(definition) ? 'nav-item--active' : ''} ${
                    key === 'trash' ? 'nav-item--danger' : ''
                  }`}
                  aria-current={isActive(definition) ? 'page' : undefined}
                  onClick={() => open(definition)}
                >
                  <Icon name={definition.icon} size={18} />
                  <span className="nav-item__label">{definition.label}</span>
                  {definition.count ? <span className="nav-item__count">{definition.count}</span> : null}
                </button>
              )
            })}
        </div>

        {showFolders ? (
          <div className="nav-section">
            <div className="nav-section__title">
              <span>Folders</span>
              {state.accounts.length > 0 ? (
                <IconButton icon="plus" label="Create a folder" size={14} onClick={() => void createFolder()} />
              ) : null}
            </div>
            {customFolders.length === 0 ? (
              <p className="nav-empty">Your folders will appear here.</p>
            ) : (
              customFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={`nav-item nav-item--sub ${
                    state.view === 'mail' && state.mailbox === `folder:${folder.id}` ? 'nav-item--active' : ''
                  }`}
                  onClick={() => actions.openMailbox(`folder:${folder.id}`)}
                >
                  <Icon name="folder" size={16} />
                  <span className="nav-item__label truncate">{folder.name}</span>
                  {folder.unreadCount > 0 ? <span className="nav-item__count">{folder.unreadCount}</span> : null}
                </button>
              ))
            )}
          </div>
        ) : null}

        {showLabels ? (
          <div className="nav-section">
            <div className="nav-section__title">Labels</div>
            {state.labels.slice(0, 12).map((label) => (
              <button
                key={label.label}
                type="button"
                className={`nav-item nav-item--sub ${
                  state.view === 'mail' && state.mailbox === `label:${label.label}` ? 'nav-item--active' : ''
                }`}
                onClick={() => actions.openMailbox(`label:${label.label}`)}
              >
                <Icon name="label" size={16} />
                <span className="nav-item__label truncate">{label.label}</span>
                <span className="nav-item__count">{label.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="nav-section">
          <div className="nav-section__title">
            <span>Workspace</span>
          </div>
          {(['contacts', 'calendar', 'tasks'] as const)
            .filter((key) => !hidden.includes(key))
            .map((key) => {
              const definition = definitions[key]!
              return (
                <button
                  key={key}
                  type="button"
                  className={`nav-item ${isActive(definition) ? 'nav-item--active' : ''}`}
                  onClick={() => open(definition)}
                >
                  <Icon name={definition.icon} size={18} />
                  <span className="nav-item__label">{definition.label}</span>
                </button>
              )
            })}
        </div>

        <div className="nav-section">
          <div className="nav-section__title">Accounts</div>
          {state.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className={`nav-item nav-item--account ${
                state.accountFilter === account.id ? 'nav-item--active' : ''
              }`}
              onClick={() => actions.setAccountFilter(account.id === state.accountFilter ? 'all' : account.id)}
              title={`${account.email} — ${account.syncState}`}
            >
              <span className="account-dot" style={{ background: account.color }} />
              <span className="nav-item__label truncate">{account.email}</span>
              {account.syncState === 'error' || account.syncState === 'auth-required' ? (
                <Icon name="warning" size={14} />
              ) : null}
            </button>
          ))}
          <button type="button" className="nav-item nav-item--add" onClick={() => actions.setWizardOpen(true)}>
            <Icon name="plus" size={16} />
            <span className="nav-item__label">Add account</span>
          </button>
        </div>
      </div>

      <div className="sidebar__footer">
        <button type="button" className="nav-item nav-item--small" onClick={() => setCustomizing(true)}>
          <Icon name="settings" size={15} />
          <span className="nav-item__label">Customise</span>
        </button>
        <button type="button" className="nav-item nav-item--small" onClick={() => actions.setView('settings', 'about')}>
          <Icon name="info" size={15} />
          <span className="nav-item__label">About</span>
        </button>
      </div>

      {customizing ? (
        <CustomizeDialog
          order={order.filter((key) => DEFAULT_ORDER.includes(key))}
          hidden={hidden}
          onClose={() => setCustomizing(false)}
          onSave={async (nextOrder, nextHidden) => {
            await actions.updateSettings({ ui: { navOrder: nextOrder, navHidden: nextHidden } })
            setCustomizing(false)
          }}
        />
      ) : null}
    </nav>
  )
}

function CustomizeDialog({
  order,
  hidden,
  onClose,
  onSave
}: {
  order: string[]
  hidden: string[]
  onClose: () => void
  onSave: (order: string[], hidden: string[]) => Promise<void>
}): ReactNode {
  const [draftOrder, setDraftOrder] = useState<string[]>(order)
  const [draftHidden, setDraftHidden] = useState<string[]>(hidden)

  const move = (index: number, direction: -1 | 1): void => {
    const next = [...draftOrder]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item!)
    setDraftOrder(next)
  }

  return (
    <Modal
      title="Customise the sidebar"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => { setDraftOrder(DEFAULT_ORDER); setDraftHidden([]) }}>
            Reset
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSave(draftOrder, draftHidden)}>
            Save
          </Button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 10 }}>
        Untick to hide a section. Use the arrows to change the order.
      </p>
      <div className="stack" style={{ gap: 4 }}>
        {draftOrder.map((key, index) => (
          <div key={key} className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={!draftHidden.includes(key)}
              onChange={(event) =>
                setDraftHidden((current) =>
                  event.target.checked ? current.filter((entry) => entry !== key) : [...current, key]
                )
              }
              aria-label={`Show ${LABELS[key] ?? key}`}
            />
            <span style={{ flex: 1 }}>{LABELS[key] ?? key}</span>
            <IconButton icon="chevronLeft" label={`Move ${LABELS[key] ?? key} up`} size={14} onClick={() => move(index, -1)} />
            <IconButton icon="chevronRight" label={`Move ${LABELS[key] ?? key} down`} size={14} onClick={() => move(index, 1)} />
          </div>
        ))}
      </div>
    </Modal>
  )
}
