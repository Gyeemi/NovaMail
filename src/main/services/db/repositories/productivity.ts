/**
 * Novamail - contacts, calendar and tasks repositories.
 * Deliberately independent from the mail tables so a broken provider calendar
 * never blocks email.
 */
import type { Attendee, CalendarEvent, Contact, Id, TaskItem } from '@shared/types'
import type { Db } from '../database'
import { newId, nowIso } from '../../../util/ids'

const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/* ---------------------------------------------------------------- contacts */

interface ContactRow {
  id: string
  account_id: string | null
  display_name: string
  emails_json: string
  phone: string | null
  company: string | null
  notes: string | null
  is_favorite: number
  groups_json: string
  last_used_at: string | null
  source: string
}

export class ContactsRepository {
  constructor(private readonly db: Db) {}

  list(): Contact[] {
    const rows = this.db
      .prepare('SELECT * FROM contacts ORDER BY is_favorite DESC, display_name COLLATE NOCASE ASC')
      .all() as ContactRow[]
    return rows.map((row) => this.map(row))
  }

  get(id: Id): Contact | null {
    const row = this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactRow | undefined
    return row ? this.map(row) : null
  }

  save(contact: Contact): Contact {
    const id = contact.id || newId()
    this.db
      .prepare(
        `INSERT INTO contacts (id, account_id, display_name, emails_json, phone, company, notes, is_favorite,
           groups_json, last_used_at, source, updated_at)
         VALUES (@id, @accountId, @displayName, @emails, @phone, @company, @notes, @favorite, @groups,
           @lastUsedAt, @source, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name, emails_json = excluded.emails_json, phone = excluded.phone,
           company = excluded.company, notes = excluded.notes, is_favorite = excluded.is_favorite,
           groups_json = excluded.groups_json, last_used_at = excluded.last_used_at, updated_at = excluded.updated_at`
      )
      .run({
        id,
        accountId: contact.accountId,
        displayName: contact.displayName,
        emails: JSON.stringify(contact.emails),
        phone: contact.phone,
        company: contact.company,
        notes: contact.notes,
        favorite: contact.isFavorite ? 1 : 0,
        groups: JSON.stringify(contact.groups),
        lastUsedAt: contact.lastUsedAt,
        source: contact.source,
        updatedAt: nowIso()
      })
    return this.get(id)!
  }

  remove(id: Id): void {
    this.db.prepare('DELETE FROM contacts WHERE id = ?').run(id)
  }

  /** Learns addresses from outgoing mail ("collected" contacts) + bumps usage. */
  recordUsage(addresses: { name: string; address: string }[]): void {
    const now = nowIso()
    for (const entry of addresses) {
      if (!entry.address.includes('@')) continue
      const existing = this.db
        .prepare("SELECT * FROM contacts WHERE emails_json LIKE ? LIMIT 1")
        .get(`%${entry.address}%`) as ContactRow | undefined
      if (existing) {
        const emails = parse<string[]>(existing.emails_json, [])
        if (!emails.some((e) => e.toLowerCase() === entry.address.toLowerCase())) continue
        this.db
          .prepare('UPDATE contacts SET last_used_at = ?, display_name = ? WHERE id = ?')
          .run(now, existing.display_name || entry.name, existing.id)
        continue
      }
      this.save({
        id: newId(),
        accountId: null,
        displayName: entry.name || entry.address,
        emails: [entry.address],
        phone: null,
        company: null,
        notes: null,
        isFavorite: false,
        groups: [],
        lastUsedAt: now,
        source: 'collected'
      })
    }
  }

  suggest(term: string, limit = 8): Contact[] {
    const needle = `%${term.toLowerCase()}%`
    const rows = this.db
      .prepare(
        `SELECT * FROM contacts WHERE lower(display_name) LIKE ? OR lower(emails_json) LIKE ?
         ORDER BY coalesce(last_used_at, '') DESC, display_name COLLATE NOCASE ASC LIMIT ?`
      )
      .all(needle, needle, limit) as ContactRow[]
    return rows.map((row) => this.map(row))
  }

  private map(row: ContactRow): Contact {
    return {
      id: row.id,
      accountId: row.account_id,
      displayName: row.display_name,
      emails: parse<string[]>(row.emails_json, []),
      phone: row.phone,
      company: row.company,
      notes: row.notes,
      isFavorite: row.is_favorite === 1,
      groups: parse<string[]>(row.groups_json, []),
      lastUsedAt: row.last_used_at,
      source: row.source as Contact['source']
    }
  }
}

/* ---------------------------------------------------------------- calendar */

interface EventRow {
  id: string
  account_id: string | null
  calendar_name: string
  title: string
  description: string
  location: string
  start_at: string
  end_at: string
  all_day: number
  attendees_json: string
  organizer: string | null
  is_recurring: number
  recurrence_rule: string | null
  reminder_minutes: number | null
  status: string
  my_response: string
  source: string
}

export class CalendarRepository {
  constructor(private readonly db: Db) {}

  list(from: string, to: string): CalendarEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM calendar_events WHERE end_at >= ? AND start_at <= ? ORDER BY start_at ASC')
      .all(from, to) as EventRow[]
    return rows.map((row) => this.map(row))
  }

  get(id: Id): CalendarEvent | null {
    const row = this.db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as EventRow | undefined
    return row ? this.map(row) : null
  }

  save(event: CalendarEvent): CalendarEvent {
    const id = event.id || newId()
    this.db
      .prepare(
        `INSERT INTO calendar_events (id, account_id, calendar_name, title, description, location, start_at,
           end_at, all_day, attendees_json, organizer, is_recurring, recurrence_rule, reminder_minutes, status,
           my_response, source, updated_at)
         VALUES (@id, @accountId, @calendarName, @title, @description, @location, @startAt, @endAt, @allDay,
           @attendees, @organizer, @isRecurring, @recurrenceRule, @reminderMinutes, @status, @myResponse,
           @source, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, description = excluded.description, location = excluded.location,
           start_at = excluded.start_at, end_at = excluded.end_at, all_day = excluded.all_day,
           attendees_json = excluded.attendees_json, organizer = excluded.organizer,
           is_recurring = excluded.is_recurring, recurrence_rule = excluded.recurrence_rule,
           reminder_minutes = excluded.reminder_minutes, status = excluded.status,
           my_response = excluded.my_response, updated_at = excluded.updated_at`
      )
      .run({
        id,
        accountId: event.accountId,
        calendarName: event.calendarName,
        title: event.title,
        description: event.description,
        location: event.location,
        startAt: event.start,
        endAt: event.end,
        allDay: event.allDay ? 1 : 0,
        attendees: JSON.stringify(event.attendees),
        organizer: event.organizer,
        isRecurring: event.isRecurring ? 1 : 0,
        recurrenceRule: event.recurrenceRule,
        reminderMinutes: event.reminderMinutes,
        status: event.status,
        myResponse: event.myResponse,
        source: event.source,
        updatedAt: nowIso()
      })
    return this.get(id)!
  }

  setResponse(id: Id, response: CalendarEvent['myResponse']): void {
    this.db.prepare('UPDATE calendar_events SET my_response = ? WHERE id = ?').run(response, id)
  }

  remove(id: Id): void {
    this.db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id)
  }

  upcoming(withinMinutes: number): CalendarEvent[] {
    const now = new Date()
    const until = new Date(now.getTime() + withinMinutes * 60_000)
    return this.list(now.toISOString(), until.toISOString())
  }

  private map(row: EventRow): CalendarEvent {
    return {
      id: row.id,
      accountId: row.account_id,
      calendarName: row.calendar_name,
      title: row.title,
      description: row.description,
      location: row.location,
      start: row.start_at,
      end: row.end_at,
      allDay: row.all_day === 1,
      attendees: parse<Attendee[]>(row.attendees_json, []),
      organizer: row.organizer,
      isRecurring: row.is_recurring === 1,
      recurrenceRule: row.recurrence_rule,
      reminderMinutes: row.reminder_minutes,
      status: row.status as CalendarEvent['status'],
      myResponse: row.my_response as CalendarEvent['myResponse'],
      source: row.source as CalendarEvent['source']
    }
  }
}

/* ------------------------------------------------------------------- tasks */

interface TaskRow {
  id: string
  account_id: string | null
  title: string
  notes: string
  due_at: string | null
  completed: number
  priority: string
  reminder_at: string | null
  created_at: string
  finished_at: string | null
}

export class TasksRepository {
  constructor(private readonly db: Db) {}

  list(): TaskItem[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks ORDER BY completed ASC, coalesce(due_at, created_at) ASC')
      .all() as TaskRow[]
    return rows.map((row) => this.map(row))
  }

  get(id: Id): TaskItem | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row ? this.map(row) : null
  }

  save(task: TaskItem): TaskItem {
    const id = task.id || newId()
    this.db
      .prepare(
        `INSERT INTO tasks (id, account_id, title, notes, due_at, completed, priority, reminder_at, created_at, finished_at)
         VALUES (@id, @accountId, @title, @notes, @dueAt, @completed, @priority, @reminderAt, @createdAt, @finishedAt)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, notes = excluded.notes, due_at = excluded.due_at,
           completed = excluded.completed, priority = excluded.priority, reminder_at = excluded.reminder_at,
           finished_at = excluded.finished_at`
      )
      .run({
        id,
        accountId: task.accountId,
        title: task.title,
        notes: task.notes,
        dueAt: task.due,
        completed: task.completed ? 1 : 0,
        priority: task.priority,
        reminderAt: task.reminderAt,
        createdAt: task.createdAt || nowIso(),
        finishedAt: task.finishedAt
      })
    return this.get(id)!
  }

  toggle(id: Id, completed: boolean): void {
    this.db
      .prepare('UPDATE tasks SET completed = ?, finished_at = ? WHERE id = ?')
      .run(completed ? 1 : 0, completed ? nowIso() : null, id)
  }

  remove(id: Id): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  private map(row: TaskRow): TaskItem {
    return {
      id: row.id,
      accountId: row.account_id,
      title: row.title,
      notes: row.notes,
      due: row.due_at,
      completed: row.completed === 1,
      priority: row.priority as TaskItem['priority'],
      reminderAt: row.reminder_at,
      createdAt: row.created_at,
      finishedAt: row.finished_at
    }
  }
}
