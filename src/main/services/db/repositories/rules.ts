/**
 * Novamail - rules / signatures / saved searches / recent searches / sync queue.
 */
import type { Id, Rule, SavedSearch, Signature } from '@shared/types'
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

export class RulesRepository {
  constructor(private readonly db: Db) {}

  list(): Rule[] {
    const rows = this.db.prepare('SELECT * FROM rules ORDER BY created_at ASC').all() as RuleRow[]
    return rows.map(mapRule)
  }

  get(id: Id): Rule | null {
    const row = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow | undefined
    return row ? mapRule(row) : null
  }

  save(rule: Rule): Rule {
    const id = rule.id || newId()
    this.db
      .prepare(
        `INSERT INTO rules (id, account_id, name, enabled, match_all, conditions_json, actions_json,
           stop_processing, created_at, match_count)
         VALUES (@id, @accountId, @name, @enabled, @matchAll, @conditions, @actions, @stop, @createdAt, @matchCount)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, enabled = excluded.enabled, match_all = excluded.match_all,
           conditions_json = excluded.conditions_json, actions_json = excluded.actions_json,
           stop_processing = excluded.stop_processing`
      )
      .run({
        id,
        accountId: rule.accountId,
        name: rule.name,
        enabled: rule.enabled ? 1 : 0,
        matchAll: rule.matchAll ? 1 : 0,
        conditions: JSON.stringify(rule.conditions),
        actions: JSON.stringify(rule.actions),
        stop: rule.stopProcessing ? 1 : 0,
        createdAt: rule.createdAt || nowIso(),
        matchCount: rule.matchCount ?? 0
      })
    return this.get(id)!
  }

  bumpMatchCount(id: Id, amount: number): void {
    this.db.prepare('UPDATE rules SET match_count = match_count + ? WHERE id = ?').run(amount, id)
  }

  remove(id: Id): void {
    this.db.prepare('DELETE FROM rules WHERE id = ?').run(id)
  }
}

interface RuleRow {
  id: string
  account_id: string | null
  name: string
  enabled: number
  match_all: number
  conditions_json: string
  actions_json: string
  stop_processing: number
  created_at: string
  match_count: number
}

function mapRule(row: RuleRow): Rule {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    enabled: row.enabled === 1,
    matchAll: row.match_all === 1,
    conditions: parse(row.conditions_json, []),
    actions: parse(row.actions_json, []),
    stopProcessing: row.stop_processing === 1,
    createdAt: row.created_at,
    matchCount: row.match_count
  }
}

export class SignaturesRepository {
  constructor(private readonly db: Db) {}

  list(): Signature[] {
    const rows = this.db
      .prepare('SELECT * FROM signatures ORDER BY is_default DESC, name ASC')
      .all() as SignatureRow[]
    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      html: row.html,
      isDefault: row.is_default === 1
    }))
  }

  save(signature: Signature): Signature {
    const id = signature.id || newId()
    const tx = this.db.transaction(() => {
      if (signature.isDefault) {
        if (signature.accountId) {
          this.db.prepare('UPDATE signatures SET is_default = 0 WHERE account_id = ?').run(signature.accountId)
        } else {
          this.db.prepare('UPDATE signatures SET is_default = 0').run()
        }
      }
      this.db
        .prepare(
          `INSERT INTO signatures (id, account_id, name, html, is_default, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, html = excluded.html,
             account_id = excluded.account_id, is_default = excluded.is_default`
        )
        .run(id, signature.accountId, signature.name, signature.html, signature.isDefault ? 1 : 0, nowIso())
    })
    tx()
    return this.list().find((s) => s.id === id)!
  }

  remove(id: Id): void {
    this.db.prepare('DELETE FROM signatures WHERE id = ?').run(id)
  }
}

interface SignatureRow {
  id: string
  account_id: string | null
  name: string
  html: string
  is_default: number
}

export class SearchHistoryRepository {
  constructor(private readonly db: Db) {}

  savedSearches(): SavedSearch[] {
    const rows = this.db.prepare('SELECT * FROM saved_searches ORDER BY created_at DESC').all() as SavedRow[]
    return rows.map((row) => ({ id: row.id, name: row.name, query: row.query, createdAt: row.created_at }))
  }

  saveSearch(name: string, query: string): SavedSearch {
    const id = newId()
    this.db
      .prepare('INSERT INTO saved_searches (id, name, query, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, query, nowIso())
    return { id, name, query, createdAt: nowIso() }
  }

  removeSaved(id: Id): void {
    this.db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id)
  }

  recordSearch(query: string): void {
    const trimmed = query.trim()
    if (trimmed.length < 2) return
    this.db
      .prepare(
        `INSERT INTO recent_searches (query, used_at, hit_count) VALUES (?, ?, 1)
         ON CONFLICT(query) DO UPDATE SET used_at = excluded.used_at, hit_count = recent_searches.hit_count + 1`
      )
      .run(trimmed, nowIso())
  }

  recentSearches(limit = 8): string[] {
    const rows = this.db
      .prepare('SELECT query FROM recent_searches ORDER BY used_at DESC LIMIT ?')
      .all(limit) as { query: string }[]
    return rows.map((row) => row.query)
  }

  clearRecent(): void {
    this.db.prepare('DELETE FROM recent_searches').run()
  }
}

interface SavedRow {
  id: string
  name: string
  query: string
  created_at: string
}

export interface QueueItem {
  id: Id
  accountId: Id
  opType: string
  payload: Record<string, unknown>
  attempts: number
  nextAttemptAt: string | null
  status: 'pending' | 'running' | 'failed' | 'done'
  lastError: string | null
}

interface QueueRow {
  id: string
  account_id: string
  op_type: string
  payload_json: string
  created_at: string
  attempts: number
  next_attempt_at: string | null
  status: string
  last_error: string | null
  dedupe_key: string | null
}

/**
 * Persistent queue of operations that must reach the server (flag changes,
 * moves, deletes, label changes). Survives restarts and offline periods.
 */
export class SyncQueueRepository {
  constructor(private readonly db: Db) {}

  enqueue(accountId: Id, opType: string, payload: Record<string, unknown>, dedupeKey?: string): Id {
    if (dedupeKey) {
      const existing = this.db
        .prepare("SELECT id FROM sync_queue WHERE dedupe_key = ? AND status IN ('pending','failed')")
        .get(dedupeKey) as { id: string } | undefined
      if (existing) return existing.id
    }
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO sync_queue (id, account_id, op_type, payload_json, created_at, attempts, next_attempt_at, status, dedupe_key)
         VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', ?)`
      )
      .run(id, accountId, opType, JSON.stringify(payload), nowIso(), nowIso(), dedupeKey ?? null)
    return id
  }

  due(limit = 25): QueueItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sync_queue WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(nowIso(), limit) as QueueRow[]
    return rows.map(mapQueue)
  }

  pendingCount(): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS c FROM sync_queue WHERE status IN ('pending','running')").get() as {
        c: number
      }
    ).c
  }

  pendingForAccount(accountId: Id): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS c FROM sync_queue WHERE account_id = ? AND status IN ('pending','running')")
        .get(accountId) as { c: number }
    ).c
  }

  list(): QueueItem[] {
    const rows = this.db.prepare('SELECT * FROM sync_queue ORDER BY created_at ASC').all() as QueueRow[]
    return rows.map(mapQueue)
  }

  complete(id: Id): void {
    this.db.prepare("UPDATE sync_queue SET status = 'done' WHERE id = ?").run(id)
  }

  fail(id: Id, error: string, retryInMs: number): void {
    const row = this.db.prepare('SELECT attempts FROM sync_queue WHERE id = ?').get(id) as
      | { attempts: number }
      | undefined
    const attempts = (row?.attempts ?? 0) + 1
    const status = attempts >= 6 ? 'failed' : 'pending'
    const next = new Date(Date.now() + retryInMs).toISOString()
    this.db
      .prepare('UPDATE sync_queue SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?')
      .run(status, attempts, error, next, id)
  }

  resetAll(): void {
    this.db.prepare("UPDATE sync_queue SET status = 'pending', attempts = 0, next_attempt_at = ?").run(nowIso())
  }

  pruneFinished(days = 7): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    return this.db.prepare("DELETE FROM sync_queue WHERE status = 'done' AND created_at < ?").run(cutoff).changes
  }
}

function mapQueue(row: QueueRow): QueueItem {
  return {
    id: row.id,
    accountId: row.account_id,
    opType: row.op_type,
    payload: parse<Record<string, unknown>>(row.payload_json, {}),
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    status: row.status as QueueItem['status'],
    lastError: row.last_error
  }
}

export class KvRepository {
  constructor(private readonly db: Db) {}

  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return fallback
    return parse<T>(row.value, fallback)
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), nowIso())
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key)
  }
}
