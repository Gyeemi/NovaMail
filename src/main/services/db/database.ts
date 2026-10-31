/**
 * Novamail - SQLite access layer (better-sqlite3).
 *
 * A single connection is opened in the main process; all repositories receive
 * it. Foreign keys, WAL and secure_delete are enabled so deleted message bodies
 * do not linger in free pages.
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { createLogger } from '../../util/logger'
import { LATEST_VERSION, migrations } from './migrations'

const log = createLogger('db')

export type Db = SqliteDatabase

export interface OpenDatabaseOptions {
  file: string
  /** in-memory databases are used by tests */
  memory?: boolean
  verbose?: boolean
}

export function openDatabase(options: OpenDatabaseOptions): Db {
  const { file, memory = false } = options
  if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(memory ? ':memory:' : file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('secure_delete = ON')
  db.pragma('temp_store = MEMORY')
  migrate(db)
  return db
}

export function migrate(db: Db): { from: number; to: number; applied: string[] } {
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0)
  const applied: string[] = []
  if (current >= LATEST_VERSION) return { from: current, to: current, applied }

  for (const migration of migrations) {
    if (migration.version <= current) continue
    const run = db.transaction(() => {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    })
    try {
      run()
      applied.push(`${migration.version}:${migration.name}`)
      log.info('migration applied', { version: migration.version, name: migration.name })
    } catch (error) {
      log.error('migration failed', { version: migration.version, error })
      throw new Error(
        `Database migration ${migration.version} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  return { from: current, to: LATEST_VERSION, applied }
}

export function closeDatabase(db: Db): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* ignore */
  }
  db.close()
}

/** Integrity check used by the diagnostics screen and at startup. */
export function integrityCheck(db: Db): { ok: boolean; details: string[] } {
  const rows = db.pragma('quick_check') as { quick_check?: string }[]
  const details = rows.map((r) => r.quick_check ?? '').filter(Boolean)
  return { ok: details.every((d) => d === 'ok'), details }
}

export function databaseSize(file: string): number {
  try {
    const base = fs.statSync(file).size
    const wal = fs.existsSync(`${file}-wal`) ? fs.statSync(`${file}-wal`).size : 0
    return base + wal
  } catch {
    return 0
  }
}
