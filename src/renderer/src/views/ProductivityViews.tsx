/**
 * Novamail - contacts, calendar and tasks.
 *
 * These live in the same local database as mail but are independent: if a
 * provider calendar is unavailable the rest of the app keeps working.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CalendarEvent, Contact, TaskItem } from '@shared/types'
import { api, errorMessage } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon } from '../components/icons'
import { Button, Chip, ConfirmDialog, EmptyState, Field, IconButton, Modal, Spinner } from '../components/ui'

/* ----------------------------------------------------------------- contacts */

export function ContactsView(): ReactNode {
  const { state, actions } = useApp()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Contact | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setContacts(await api.contacts.list())
    } catch (error) {
      actions.pushToast({ tone: 'error', title: 'Contacts could not be loaded', description: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [actions])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = contacts.filter((contact) => {
    const needle = query.toLowerCase()
    return (
      !needle ||
      contact.displayName.toLowerCase().includes(needle) ||
      contact.emails.some((email) => email.toLowerCase().includes(needle))
    )
  })

  return (
    <section className="panel" style={{ flex: 1 }} aria-label="Contacts">
      <div className="list-toolbar">
        <div className="list-title">Contacts</div>
        <input
          className="input"
          style={{ maxWidth: 280, minHeight: 36 }}
          placeholder="Search contacts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search contacts"
        />
        <Button
          variant="primary"
          icon="plus"
          onClick={() =>
            setEditing({
              id: '',
              accountId: state.accounts[0]?.id ?? null,
              displayName: '',
              emails: [''],
              phone: null,
              company: null,
              notes: null,
              isFavorite: false,
              groups: [],
              lastUsedAt: null,
              source: 'local'
            })
          }
        >
          New contact
        </Button>
      </div>

      <div className="list-scroll">
        {loading ? <Spinner label="Loading contacts" /> : null}
        {!loading && filtered.length === 0 ? (
          <EmptyState
            icon="contacts"
            title="No contacts yet"
            description="Contacts are added automatically when you write to someone, or you can create one by hand."
          />
        ) : null}
        {filtered.map((contact) => (
          <div key={contact.id} className="task-row">
            <span className="list-item__avatar" style={{ width: 36, height: 36 }}>
              {contact.displayName.slice(0, 2).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row">
                <strong>{contact.displayName}</strong>
                {contact.isFavorite ? <Chip tone="accent">Favourite</Chip> : null}
                <Chip>{contact.source === 'collected' ? 'From your mail' : contact.source}</Chip>
              </div>
              <div className="small muted">{contact.emails.join(', ')}</div>
              {contact.company ? <div className="tiny muted">{contact.company}</div> : null}
            </div>
            <IconButton icon="compose" label={`Write to ${contact.displayName}`} onClick={() => void actions.openCompose({
              mode: 'new',
              accountId: state.settings?.defaultAccountId ?? state.accounts[0]?.id ?? '',
              to: contact.emails.filter(Boolean).map((email) => ({ name: contact.displayName, address: email })),
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
            })} />
            <IconButton icon="compose" label="Edit contact" onClick={() => setEditing(contact)} style={{ display: 'none' }} />
            <Button size="sm" onClick={() => setEditing(contact)}>
              Edit
            </Button>
          </div>
        ))}
      </div>

      {editing ? (
        <ContactEditor
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            setEditing(null)
            await load()
            actions.pushToast({ tone: 'success', title: 'Contact saved', description: saved.displayName })
          }}
        />
      ) : null}
    </section>
  )
}

function ContactEditor({
  contact,
  onClose,
  onSaved
}: {
  contact: Contact
  onClose: () => void
  onSaved: (contact: Contact) => void
}): ReactNode {
  const [draft, setDraft] = useState<Contact>(contact)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      title={contact.id ? 'Edit contact' : 'New contact'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          {contact.id ? (
            <Button
              variant="danger"
              onClick={async () => {
                await api.contacts.remove(contact.id)
                onSaved({ ...draft, displayName: 'Contact' })
              }}
            >
              Delete
            </Button>
          ) : null}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (!draft.displayName.trim()) {
                setError('Enter a name.')
                return
              }
              try {
                const saved = await api.contacts.save({
                  ...draft,
                  emails: draft.emails.map((email) => email.trim()).filter(Boolean)
                })
                onSaved(saved)
              } catch (saveError) {
                setError(errorMessage(saveError))
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? <span className="field__error">{error}</span> : null}
        <Field label="Name">
          <input className="input" value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
        </Field>
        <Field label="Email addresses" hint="One address per line.">
          <textarea
            className="textarea"
            value={draft.emails.join('\n')}
            onChange={(event) => setDraft({ ...draft, emails: event.target.value.split('\n') })}
          />
        </Field>
        <Field label="Company (optional)">
          <input
            className="input"
            value={draft.company ?? ''}
            onChange={(event) => setDraft({ ...draft, company: event.target.value || null })}
          />
        </Field>
        <Field label="Phone (optional)">
          <input
            className="input"
            value={draft.phone ?? ''}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value || null })}
          />
        </Field>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.isFavorite}
            onChange={(event) => setDraft({ ...draft, isFavorite: event.target.checked })}
          />
          <span className="checkbox-row__text">
            <strong>Favourite</strong>
            <span>Shown at the top of contact suggestions.</span>
          </span>
        </label>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- calendar */

type CalendarMode = 'month' | 'week' | 'day' | 'agenda'

export function CalendarView(): ReactNode {
  const { actions } = useApp()
  const [mode, setMode] = useState<CalendarMode>('month')
  const [cursor, setCursor] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)

  const range = useMemo(() => {
    const start = new Date(cursor)
    if (mode === 'month') {
      start.setDate(1)
      start.setDate(start.getDate() - start.getDay())
      const end = new Date(start)
      end.setDate(start.getDate() + 42)
      return { from: start, to: end }
    }
    if (mode === 'week') {
      const first = new Date(cursor)
      first.setDate(first.getDate() - first.getDay())
      const end = new Date(first)
      end.setDate(first.getDate() + 7)
      return { from: first, to: end }
    }
    if (mode === 'day') {
      const from = new Date(cursor)
      from.setHours(0, 0, 0, 0)
      const to = new Date(from)
      to.setDate(to.getDate() + 1)
      return { from, to }
    }
    return { from: new Date(cursor.getFullYear(), cursor.getMonth(), 1), to: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) }
  }, [cursor, mode])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEvents(await api.calendar.list({ from: range.from.toISOString(), to: range.to.toISOString() }))
    } catch (error) {
      actions.pushToast({ tone: 'error', title: 'Calendar could not be loaded', description: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [actions, range.from, range.to])

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo(() => {
    const list: Date[] = []
    const start = new Date(range.from)
    const end = new Date(range.to)
    while (start < end) {
      list.push(new Date(start))
      start.setDate(start.getDate() + 1)
    }
    return list
  }, [range])

  const eventsFor = (day: Date): CalendarEvent[] =>
    events.filter((event) => {
      const start = new Date(event.start)
      return start.toDateString() === day.toDateString()
    })

  return (
    <section className="panel" style={{ flex: 1 }} aria-label="Calendar">
      <div className="list-toolbar">
        <div className="list-title">
          {mode === 'agenda' ? 'Agenda' : cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </div>
        <Button size="sm" icon="chevronLeft" onClick={() => setCursor(shift(cursor, mode, -1))} aria-label="Previous period">
          Previous
        </Button>
        <Button size="sm" onClick={() => setCursor(new Date())}>
          Today
        </Button>
        <Button size="sm" onClick={() => setCursor(shift(cursor, mode, 1))}>
          Next
        </Button>
        <select
          className="select"
          style={{ maxWidth: 140, minHeight: 36 }}
          value={mode}
          onChange={(event) => setMode(event.target.value as CalendarMode)}
          aria-label="Calendar view"
        >
          <option value="month">Month</option>
          <option value="week">Week</option>
          <option value="day">Day</option>
          <option value="agenda">Agenda</option>
        </select>
        <Button
          variant="primary"
          icon="plus"
          onClick={() =>
            setEditing({
              id: '',
              accountId: null,
              calendarName: 'Personal',
              title: '',
              description: '',
              location: '',
              start: new Date(cursor).toISOString(),
              end: new Date(new Date(cursor).getTime() + 3600_000).toISOString(),
              allDay: false,
              attendees: [],
              organizer: null,
              isRecurring: false,
              recurrenceRule: null,
              reminderMinutes: 10,
              status: 'confirmed',
              myResponse: 'needs-action',
              source: 'local'
            })
          }
        >
          New event
        </Button>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading ? <Spinner label="Loading the calendar" /> : null}
        {mode === 'month' || mode === 'week' ? (
          <div className="calendar-grid" style={{ gridTemplateRows: 'auto repeat(auto-fit, minmax(84px, 1fr))' }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
              <div key={label} className="tiny muted" style={{ textAlign: 'center', fontWeight: 700 }}>
                {label}
              </div>
            ))}
            {days.map((day) => (
              <button
                key={day.toISOString()}
                type="button"
                className={`calendar-cell ${day.getMonth() !== cursor.getMonth() ? 'calendar-cell--muted' : ''} ${
                  day.toDateString() === new Date().toDateString() ? 'calendar-cell--today' : ''
                }`}
                onClick={() => {
                  setCursor(day)
                  setMode('day')
                }}
              >
                <span className="small" style={{ fontWeight: 600 }}>
                  {day.getDate()}
                </span>
                {eventsFor(day)
                  .slice(0, 3)
                  .map((event) => (
                    <span key={event.id} className="calendar-event" title={event.title}>
                      {event.title}
                    </span>
                  ))}
              </button>
            ))}
          </div>
        ) : mode === 'day' ? (
          <div className="stack">
            <h3 style={{ fontSize: 'var(--nm-title-size)' }}>
              {cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </h3>
            {eventsFor(cursor).length === 0 ? (
              <EmptyState icon="calendar" title="Nothing scheduled" description="Add an event to plan this day." />
            ) : (
              eventsFor(cursor).map((event) => <EventRow key={event.id} event={event} onOpen={() => setEditing(event)} />)
            )}
          </div>
        ) : (
          <div className="stack">
            {events.length === 0 ? (
              <EmptyState icon="calendar" title="No events this month" description="Meeting invitations you receive by email appear here too." />
            ) : (
              events.map((event) => <EventRow key={event.id} event={event} onOpen={() => setEditing(event)} />)
            )}
          </div>
        )}
      </div>

      {editing ? (
        <EventEditor
          event={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      ) : null}
    </section>
  )
}

function shift(cursor: Date, mode: CalendarMode, direction: 1 | -1): Date {
  const next = new Date(cursor)
  if (mode === 'month') next.setMonth(next.getMonth() + direction)
  else if (mode === 'week') next.setDate(next.getDate() + 7 * direction)
  else if (mode === 'day') next.setDate(next.getDate() + direction)
  else next.setMonth(next.getMonth() + direction)
  return next
}

function EventRow({ event, onOpen }: { event: CalendarEvent; onOpen: () => void }): ReactNode {
  const { actions } = useApp()
  return (
    <div className="settings-group" style={{ gap: 6 }}>
      <div className="row">
        <strong>{event.title}</strong>
        <Chip tone="accent">{new Date(event.start).toLocaleString()}</Chip>
        {event.location ? <Chip>{event.location}</Chip> : null}
        <span className="spacer" />
        <Button size="sm" onClick={onOpen}>
          Open
        </Button>
      </div>
      {event.description ? <p className="small muted">{event.description}</p> : null}
      {event.attendees.length > 0 ? (
        <div className="row">
          <span className="small muted">Attendees:</span>
          {event.attendees.map((attendee) => (
            <Chip key={attendee.email}>
              {attendee.name || attendee.email} — {attendee.status}
            </Chip>
          ))}
        </div>
      ) : null}
      {event.myResponse === 'needs-action' ? (
        <div className="row">
          <span className="small">Respond:</span>
          {(['accepted', 'tentative', 'declined'] as const).map((response) => (
            <Button
              key={response}
              size="sm"
              onClick={async () => {
                await api.calendar.respond({ id: event.id, response })
                actions.pushToast({ tone: 'success', title: `Invitation ${response}` })
              }}
            >
              {response === 'accepted' ? 'Accept' : response === 'tentative' ? 'Maybe' : 'Decline'}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function EventEditor({
  event,
  onClose,
  onSaved
}: {
  event: CalendarEvent
  onClose: () => void
  onSaved: () => void
}): ReactNode {
  const [draft, setDraft] = useState<CalendarEvent>(event)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const toLocalInput = (value: string): string => {
    const date = new Date(value)
    const offset = date.getTimezoneOffset() * 60_000
    return new Date(date.getTime() - offset).toISOString().slice(0, 16)
  }

  return (
    <Modal
      title={event.id ? 'Event' : 'New event'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          {event.id ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ) : null}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const saved = await api.calendar.save(draft)
              void saved
              onSaved()
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Title">
          <input className="input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </Field>
        <Field label="Starts">
          <input
            className="input"
            type="datetime-local"
            value={toLocalInput(draft.start)}
            onChange={(target) => setDraft({ ...draft, start: new Date(target.target.value).toISOString() })}
          />
        </Field>
        <Field label="Ends">
          <input
            className="input"
            type="datetime-local"
            value={toLocalInput(draft.end)}
            onChange={(target) => setDraft({ ...draft, end: new Date(target.target.value).toISOString() })}
          />
        </Field>
        <Field label="Location">
          <input className="input" value={draft.location} onChange={(target) => setDraft({ ...draft, location: target.target.value })} />
        </Field>
        <Field label="Notes">
          <textarea
            className="textarea"
            value={draft.description}
            onChange={(target) => setDraft({ ...draft, description: target.target.value })}
          />
        </Field>
        <Field label="Reminder" hint="Desktop reminders need Novamail to be running.">
          <select
            className="select"
            value={String(draft.reminderMinutes ?? '')}
            onChange={(target) =>
              setDraft({ ...draft, reminderMinutes: target.target.value === '' ? null : Number(target.target.value) })
            }
          >
            <option value="">No reminder</option>
            <option value="0">At the start</option>
            <option value="5">5 minutes before</option>
            <option value="10">10 minutes before</option>
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
          </select>
        </Field>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete this event?"
          message="The event is removed from Novamail. Calendar providers are not modified in this version."
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api.calendar.remove(event.id)
            setConfirmDelete(false)
            onSaved()
          }}
        />
      ) : null}
    </Modal>
  )
}

/* -------------------------------------------------------------------- tasks */

export function TasksView(): ReactNode {
  const { actions } = useApp()
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setTasks(await api.tasks.list())
    } catch (error) {
      actions.pushToast({ tone: 'error', title: 'Tasks could not be loaded', description: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [actions])

  useEffect(() => {
    void load()
  }, [load])

  const add = async (): Promise<void> => {
    if (!title.trim()) return
    await api.tasks.save({
      id: '',
      accountId: null,
      title: title.trim(),
      notes: '',
      due: due ? new Date(due).toISOString() : null,
      completed: false,
      priority: 'normal',
      reminderAt: null,
      createdAt: new Date().toISOString(),
      finishedAt: null
    })
    setTitle('')
    setDue('')
    await load()
  }

  return (
    <section className="panel" style={{ flex: 1 }} aria-label="Tasks">
      <div className="list-toolbar">
        <div className="list-title">Tasks</div>
        <input
          className="input"
          style={{ maxWidth: 320, minHeight: 36 }}
          placeholder="What needs to be done?"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
          aria-label="New task"
        />
        <input
          className="input"
          type="date"
          style={{ maxWidth: 170, minHeight: 36 }}
          value={due}
          onChange={(event) => setDue(event.target.value)}
          aria-label="Due date"
        />
        <Button variant="primary" icon="plus" onClick={() => void add()}>
          Add task
        </Button>
      </div>

      <div className="list-scroll">
        {loading ? <Spinner label="Loading tasks" /> : null}
        {!loading && tasks.length === 0 ? (
          <EmptyState icon="tasks" title="No tasks yet" description="Add a task with a due date to keep track of what matters." />
        ) : null}
        {tasks.map((task) => (
          <div key={task.id} className={`task-row ${task.completed ? 'task-row--done' : ''}`}>
            <input
              type="checkbox"
              checked={task.completed}
              onChange={async (event) => {
                await api.tasks.toggle({ id: task.id, completed: event.target.checked })
                await load()
              }}
              aria-label={`Mark ${task.title} as ${task.completed ? 'not done' : 'done'}`}
              style={{ width: 20, height: 20, marginTop: 2, accentColor: 'var(--nm-accent)' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="task-row__title" style={{ fontWeight: 600 }}>
                {task.title}
              </div>
              <div className="small muted">
                {task.due ? `Due ${new Date(task.due).toLocaleDateString()}` : 'No due date'}
                {task.priority !== 'normal' ? ` • ${task.priority} priority` : ''}
              </div>
            </div>
            <IconButton
              icon="trash"
              label={`Delete ${task.title}`}
              onClick={async () => {
                await api.tasks.remove(task.id)
                await load()
              }}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
