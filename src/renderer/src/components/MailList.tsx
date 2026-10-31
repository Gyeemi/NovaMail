/**
 * Novamail - message list.
 *
 * Handles selection, bulk actions, sorting and the per-message affordances
 * (star, read, attachment and thread indicators). Every action goes through the
 * provider so the reading pane and sidebar counts stay in step.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { Folder, MessageSummary } from '@shared/types'
import { useApp } from '../state/AppProvider'
import { Icon } from './icons'
import {
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Modal,
  Spinner,
  formatDate,
  initials
} from './ui'

const TITLES: Record<string, string> = {
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
  trash: 'Trash'
}

function titleFor(mailbox: string, folders: Folder[]): string {
  if (TITLES[mailbox]) return TITLES[mailbox]!
  if (mailbox.startsWith('folder:')) {
    const id = mailbox.slice('folder:'.length)
    return folders.find((folder) => folder.id === id)?.name ?? 'Folder'
  }
  if (mailbox.startsWith('label:')) return mailbox.slice('label:'.length)
  return 'Mail'
}

function snoozeOptions(): { label: string; until: string }[] {
  const now = new Date()
  const at = (days: number, hour: number): string => {
    const date = new Date(now)
    date.setDate(date.getDate() + days)
    date.setHours(hour, 0, 0, 0)
    return date.toISOString()
  }
  const thisEvening = new Date(now)
  thisEvening.setHours(18, 0, 0, 0)
  const options = [
    { label: 'In 1 hour', until: new Date(now.getTime() + 3_600_000).toISOString() },
    { label: 'Later today (18:00)', until: thisEvening.toISOString() },
    { label: 'Tomorrow morning', until: at(1, 8) },
    { label: 'This weekend', until: at((6 - now.getDay() + 7) % 7 || 6, 9) },
    { label: 'Next week', until: at(7, 9) }
  ]
  return options
}

export function MailList(): ReactNode {
  const { state, actions } = useApp()
  const [filter, setFilter] = useState<'all' | 'unread' | 'attachments'>('all')
  const [sort, setSort] = useState<'date' | 'sender' | 'subject'>('date')
  const [showBulk, setShowBulk] = useState(false)
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)

  const settings = state.settings
  const compact = settings?.ui.density === 'compact'
  const selectedCount = state.selectedIds.length
  const title = state.isSearching ? `Results for “${state.searchQuery}”` : titleFor(state.mailbox, state.folders)

  const messages = useMemo(() => {
    const filtered = state.messages.filter((message) => {
      if (filter === 'unread') return !message.isRead
      if (filter === 'attachments') return message.hasAttachments
      return true
    })
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'sender') return a.from.name.localeCompare(b.from.name)
      if (sort === 'subject') return a.subject.localeCompare(b.subject)
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    })
    return sorted
  }, [state.messages, filter, sort])

  const allSelected = messages.length > 0 && state.selectedIds.length === messages.length

  return (
    <section className="panel list-pane" aria-label={title}>
      <div className="list-toolbar">
        <div style={{ minWidth: 0 }}>
          <div className="list-title truncate">{title}</div>
          <div className="small muted">
            {state.listLoading ? 'Loading…' : `${state.total} ${state.total === 1 ? 'message' : 'messages'}`}
            {state.isSearching ? ' • searched locally and on the server' : ''}
          </div>
        </div>
        <span className="spacer" />

        <div className="segmented segmented--compact" role="group" aria-label="Filter messages">
          {(
            [
              { id: 'all', label: 'All', icon: 'mail' },
              { id: 'unread', label: 'Unread', icon: 'eye' },
              { id: 'attachments', label: 'Files', icon: 'attachment' }
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              title={option.label}
            >
              <Icon name={option.icon} size={15} />
            </button>
          ))}
        </div>

        <select
          className="select select--compact"
          value={sort}
          aria-label="Sort messages"
          onChange={(event) => setSort(event.target.value as typeof sort)}
        >
          <option value="date">Newest first</option>
          <option value="sender">By sender</option>
          <option value="subject">By subject</option>
        </select>

        <IconButton icon="refresh" label="Refresh this list" onClick={() => void actions.refreshList()} />

        {state.mailbox === 'trash' ? (
          <Button size="sm" variant="danger" onClick={() => setConfirmEmptyTrash(true)}>
            Empty trash
          </Button>
        ) : null}
      </div>

      <div className="list-bulk">
        <label className="checkbox-row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => (allSelected ? actions.clearSelection() : actions.selectAll())}
            aria-label="Select all messages in this list"
          />
          <span className="small muted">{selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}</span>
        </label>
        {selectedCount > 0 ? (
          <>
            <span className="spacer" />
            <IconButton icon="save" label="Mark as read" onClick={() => void actions.flag('isRead', true)} />
            <IconButton icon="eyeOff" label="Mark as unread" onClick={() => void actions.flag('isRead', false)} />
            <IconButton icon="star" label="Star" onClick={() => void actions.flag('isStarred', true)} />
            <IconButton icon="archive" label="Archive" onClick={() => void actions.archive()} />
            <IconButton icon="more" label="More actions" onClick={() => setShowBulk(true)} />
            <IconButton icon="trash" label="Delete" onClick={() => void actions.trash()} />
            <IconButton icon="close" label="Clear the selection" onClick={() => actions.clearSelection()} />
          </>
        ) : null}
      </div>

      {state.listError ? (
        <div className="banner banner--danger" role="alert" style={{ margin: 12 }}>
          <Icon name="error" size={16} />
          <div>
            <strong>This list could not be loaded.</strong>
            <div className="small">{state.listError}</div>
          </div>
        </div>
      ) : null}

      <div className="list-scroll">
        {state.listLoading && messages.length === 0 ? <Spinner label="Loading messages" /> : null}

        {!state.listLoading && messages.length === 0 ? (
          <EmptyState
            icon={state.isSearching ? 'search' : 'inbox'}
            title={state.isSearching ? 'No messages match that search' : 'Nothing here yet'}
            description={
              state.isSearching
                ? 'Try fewer words, or search for a sender with from:name, or for files with has:attachment.'
                : state.mailbox === 'unified'
                  ? 'New mail will appear here as soon as your account synchronises.'
                  : 'This mailbox is empty.'
            }
            action={
              state.mailbox === 'unified' && state.accounts.length === 0 ? (
                <Button variant="primary" onClick={() => actions.setWizardOpen(true)}>
                  Add your first account
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            selected={state.selectedIds.includes(message.id)}
            active={state.activeId === message.id}
            compact={compact}
            showSnippet={settings?.ui.showSnippets ?? true}
            onOpen={() => void actions.selectMessage(message.id)}
            onToggle={() => actions.toggleSelection(message.id)}
            onStar={() => void actions.flag('isStarred', !message.isStarred, [message.id])}
            onImportant={() => void actions.flag('isImportant', !message.isImportant, [message.id])}
          />
        ))}
      </div>

      {showBulk ? (
        <BulkDialog
          count={selectedCount}
          folders={state.folders}
          hasSelection={selectedCount > 0}
          labels={state.labels.map((entry) => entry.label)}
          onClose={() => setShowBulk(false)}
          onMove={async (folderId) => {
            await actions.moveTo(folderId)
            setShowBulk(false)
          }}
          onSnooze={async (until) => {
            await actions.snooze(state.selectedIds, until)
            setShowBulk(false)
          }}
          onLabel={async (label) => {
            await actions.addLabel(label)
            setShowBulk(false)
          }}
          onDeletePermanently={async () => {
            await actions.deletePermanently(state.selectedIds)
            setShowBulk(false)
          }}
        />
      ) : null}

      {confirmEmptyTrash ? (
        <ConfirmDialog
          title="Delete everything in the Trash?"
          message="Every message in the trash folder is removed from this computer and from the server. This cannot be undone."
          confirmLabel="Empty trash"
          destructive
          onCancel={() => setConfirmEmptyTrash(false)}
          onConfirm={async () => {
            setConfirmEmptyTrash(false)
            await actions.deletePermanently(messages.map((message) => message.id))
          }}
        />
      ) : null}
    </section>
  )
}

function MessageRow({
  message,
  selected,
  active,
  compact,
  showSnippet,
  onOpen,
  onToggle,
  onStar,
  onImportant
}: {
  message: MessageSummary
  selected: boolean
  active: boolean
  compact: boolean
  showSnippet: boolean
  onOpen: () => void
  onToggle: () => void
  onStar: () => void
  onImportant: () => void
}): ReactNode {
  const accountColor = message.accountId ? undefined : undefined
  return (
    <div
      className={`list-item ${message.isRead ? '' : 'list-item--unread'} ${active ? 'list-item--active' : ''} ${
        selected ? 'list-item--selected' : ''
      } ${compact ? 'list-item--compact' : ''}`}
      data-message-id={message.id}
      role="row"
      tabIndex={0}
      aria-label={`${message.isRead ? '' : 'Unread, '}${message.subject || '(no subject)'} from ${
        message.from.name || message.from.address
      }`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="list-item__check" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${message.subject || 'message'}`}
        />
      </div>

      <div className="list-item__avatar" aria-hidden="true" style={{ background: accountColor }}>
        {initials(message.from.name, message.from.address)}
      </div>

      <div className="list-item__body">
        <div className="list-item__row">
          <span className="list-item__from truncate">
            {message.from.name || message.from.address || 'Unknown sender'}
          </span>
          <span className="list-item__time small muted">
            {message.isDraft ? 'Draft' : ''} {formatDate(message.date)}
          </span>
        </div>
        <div className="list-item__row">
          <span className="list-item__subject truncate">
            {message.isStarred ? <Icon name="starFilled" size={12} /> : null}
            {message.isImportant ? <Icon name="important" size={12} /> : null}
            {message.subject || '(no subject)'}
            {message.threadCount && message.threadCount > 1 ? (
              <span className="thread-count">{message.threadCount}</span>
            ) : null}
          </span>
        </div>
        {showSnippet && !compact ? (
          <div className="list-item__snippet small muted truncate">{message.snippet}</div>
        ) : null}
        <div className="list-item__meta">
          {message.hasAttachments ? (
            <span className="list-item__flag" title={`${message.attachmentCount} attachment(s)`}>
              <Icon name="attachment" size={13} />
              {message.attachmentCount > 1 ? message.attachmentCount : ''}
            </span>
          ) : null}
          {message.labels.slice(0, 2).map((label) => (
            <Chip key={label} tone="accent">
              {label}
            </Chip>
          ))}
          {message.isSnoozed ? (
            <span className="list-item__flag" title="Snoozed">
              <Icon name="snooze" size={13} />
            </span>
          ) : null}
        </div>
      </div>

      <div className="list-item__actions" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={`icon-btn icon-btn--bare ${message.isStarred ? 'is-on' : ''}`}
          aria-label={message.isStarred ? 'Remove the star' : 'Star this message'}
          aria-pressed={message.isStarred}
          onClick={onStar}
        >
          <Icon name={message.isStarred ? 'starFilled' : 'star'} size={15} />
        </button>
        <button
          type="button"
          className={`icon-btn icon-btn--bare ${message.isImportant ? 'is-on' : ''}`}
          aria-label={message.isImportant ? 'Remove the importance mark' : 'Mark as important'}
          aria-pressed={message.isImportant}
          onClick={onImportant}
        >
          <Icon name="important" size={15} />
        </button>
      </div>
    </div>
  )
}

function BulkDialog({
  count,
  folders,
  hasSelection,
  labels,
  onClose,
  onMove,
  onSnooze,
  onLabel,
  onDeletePermanently
}: {
  count: number
  folders: Folder[]
  hasSelection: boolean
  labels: string[]
  onClose: () => void
  onMove: (folderId: string) => Promise<void>
  onSnooze: (until: string) => Promise<void>
  onLabel: (label: string) => Promise<void>
  onDeletePermanently: () => Promise<void>
}): ReactNode {
  const [label, setLabel] = useState(labels[0] ?? '')
  const [newLabel, setNewLabel] = useState('')
  const options = snoozeOptions()

  return (
    <Modal
      title={hasSelection ? `${count} messages` : 'Message actions'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <span className="modal__footer-note">Changes synchronise to the server in the background.</span>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div>
          <div className="field__label">Move to folder</div>
          <div className="stack" style={{ gap: 4, maxHeight: 180, overflow: 'auto' }}>
            {folders
              .filter((folder) => folder.kind !== 'outbox')
              .slice(0, 20)
              .map((folder) => (
                <button key={folder.id} type="button" className="popover__item" onClick={() => void onMove(folder.id)}>
                  <Icon name="folder" size={15} />
                  <span className="truncate">{folder.name}</span>
                </button>
              ))}
          </div>
        </div>

        <div>
          <div className="field__label">Snooze until</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {options.map((option) => (
              <Button key={option.label} size="sm" onClick={() => void onSnooze(option.until)}>
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <div className="field__label">Add a label</div>
          <div className="row" style={{ gap: 6 }}>
            {labels.length > 0 ? (
              <select className="select" value={label} onChange={(event) => setLabel(event.target.value)} aria-label="Label">
                {labels.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              className="input"
              placeholder="New label name"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              aria-label="New label name"
            />
            <Button size="sm" onClick={() => void onLabel((newLabel || label).trim())} disabled={!newLabel && !label}>
              Add
            </Button>
          </div>
        </div>

        <div>
          <div className="field__label">Permanently delete</div>
          <Button variant="danger" size="sm" icon="trash" onClick={() => void onDeletePermanently()}>
            Delete for good
          </Button>
        </div>
      </div>
    </Modal>
  )
}
