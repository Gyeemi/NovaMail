/**
 * Novamail - drafts and outbox repository.
 *
 * The outbox owns the send queue: a row is written *before* the network call so
 * a crash or power cut can never lose a message or send it twice
 * (dedupe_key is unique and the row is only marked `sent` after SMTP accepted).
 */
import { createHash } from 'node:crypto'
import type { ComposePayload, Id, OutboxItem, OutboxStatus } from '@shared/types'
import type { Db } from '../database'
import { newId, nowIso } from '../../../util/ids'

interface DraftRow {
  id: string
  account_id: string
  payload_json: string
  updated_at: string
  created_at: string
}

interface OutboxRow {
  id: string
  account_id: string
  account_email?: string
  payload_json: string
  status: string
  attempts: number
  last_error: string | null
  scheduled_at: string | null
  created_at: string
  sent_at: string | null
  dedupe_key: string
}

export function outboxDedupeKey(payload: ComposePayload): string {
  const material = JSON.stringify({
    a: payload.accountId,
    to: payload.to.map((t) => t.address.toLowerCase()).sort(),
    s: payload.subject,
    b: (payload.html || payload.text || '').slice(0, 4096),
    d: payload.draftId ?? null
  })
  return createHash('sha256').update(material).digest('hex')
}

export class ComposeRepository {
  constructor(private readonly db: Db) {}

  /* --------------------------------------------------------------- drafts */

  saveDraft(payload: ComposePayload): Id {
    const id = payload.draftId ?? newId()
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO drafts (id, account_id, payload_json, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
      )
      .run(id, payload.accountId, JSON.stringify({ ...payload, draftId: id }), now, now)
    return id
  }

  getDraft(id: Id): (ComposePayload & { updatedAt: string }) | null {
    const row = this.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as DraftRow | undefined
    if (!row) return null
    return { ...(JSON.parse(row.payload_json) as ComposePayload), updatedAt: row.updated_at }
  }

  listDrafts(): (ComposePayload & { updatedAt: string })[] {
    const rows = this.db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC').all() as DraftRow[]
    return rows.map((row) => ({ ...(JSON.parse(row.payload_json) as ComposePayload), updatedAt: row.updated_at }))
  }

  deleteDraft(id: Id): void {
    this.db.prepare('DELETE FROM drafts WHERE id = ?').run(id)
  }

  /* --------------------------------------------------------------- outbox */

  enqueue(payload: ComposePayload, options: { scheduledAt?: string | null; dedupeKey?: string } = {}): OutboxItem {
    const id = newId()
    const dedupeKey = options.dedupeKey ?? outboxDedupeKey(payload)
    const existing = this.db.prepare('SELECT id FROM outbox WHERE dedupe_key = ?').get(dedupeKey) as
      | { id: string }
      | undefined
    if (existing) {
      const item = this.getOutbox(existing.id)
      if (item) return item
    }
    this.db
      .prepare(
        `INSERT INTO outbox (id, account_id, payload_json, status, attempts, scheduled_at, created_at, dedupe_key)
         VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`
      )
      .run(id, payload.accountId, JSON.stringify(payload), options.scheduledAt ?? null, nowIso(), dedupeKey)
    return this.getOutbox(id)!
  }

  getOutbox(id: Id): OutboxItem | null {
    const row = this.db
      .prepare(
        `SELECT o.*, a.email AS account_email FROM outbox o LEFT JOIN accounts a ON a.id = o.account_id WHERE o.id = ?`
      )
      .get(id) as OutboxRow | undefined
    return row ? this.mapOutbox(row) : null
  }

  listOutbox(): OutboxItem[] {
    const rows = this.db
      .prepare(
        `SELECT o.*, a.email AS account_email FROM outbox o LEFT JOIN accounts a ON a.id = o.account_id
         ORDER BY coalesce(o.scheduled_at, o.created_at) ASC`
      )
      .all() as OutboxRow[]
    return rows.map((row) => this.mapOutbox(row))
  }

  /** Rows that are due for sending (queued + schedule elapsed, or queued now). */
  dueOutbox(now = nowIso()): { id: Id; payload: ComposePayload }[] {
    const rows = this.db
      .prepare(
        `SELECT id, payload_json FROM outbox
         WHERE status = 'queued' AND (scheduled_at IS NULL OR scheduled_at <= ?)
         ORDER BY coalesce(scheduled_at, created_at) ASC LIMIT 25`
      )
      .all(now) as { id: string; payload_json: string }[]
    return rows.map((row) => ({ id: row.id, payload: JSON.parse(row.payload_json) as ComposePayload }))
  }

  markSending(id: Id): void {
    this.db.prepare("UPDATE outbox SET status = 'sending', attempts = attempts + 1 WHERE id = ?").run(id)
  }

  markSent(id: Id): void {
    this.db.prepare("UPDATE outbox SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?").run(nowIso(), id)
  }

  markFailed(id: Id, error: string): void {
    this.db.prepare("UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?").run(error, id)
  }

  makeDueNow(id: Id): void {
    this.db.prepare("UPDATE outbox SET scheduled_at = ? WHERE id = ? AND status = 'queued'").run(nowIso(), id)
  }

  requeue(id: Id): void {
    this.db.prepare("UPDATE outbox SET status = 'queued', last_error = NULL WHERE id = ?").run(id)
  }

  cancel(id: Id): void {
    this.db.prepare("UPDATE outbox SET status = 'cancelled' WHERE id = ?").run(id)
  }

  remove(id: Id): void {
    this.db.prepare('DELETE FROM outbox WHERE id = ?').run(id)
  }

  pruneSentOlderThan(days = 30): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    const info = this.db
      .prepare("DELETE FROM outbox WHERE status IN ('sent','cancelled') AND coalesce(sent_at, created_at) < ?")
      .run(cutoff)
    return info.changes
  }

  private mapOutbox(row: OutboxRow): OutboxItem {
    const payload = JSON.parse(row.payload_json) as ComposePayload
    return {
      id: row.id,
      accountId: row.account_id,
      accountEmail: row.account_email ?? '',
      subject: payload.subject || '(no subject)',
      recipients: payload.to.map((t) => t.address),
      status: row.status as OutboxStatus,
      attempts: row.attempts,
      lastError: row.last_error,
      scheduledAt: row.scheduled_at,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      undoable: row.status === 'sent' && Boolean(row.sent_at) && Date.now() - Date.parse(row.sent_at ?? '') < 60_000
    }
  }
}
