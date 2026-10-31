/**
 * Novamail - backup and restore.
 *
 * A backup is a ZIP archive that contains the local database as JSON, the
 * readable settings file, and a manifest describing what is inside. Credentials
 * and OAuth tokens are deliberately excluded: a backup is a mail archive, not a
 * key file, so it can be copied to a new computer without carrying secrets.
 */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import type { BackupManifest } from '@shared/types'
import type { Db } from '../db/database'
import type { SettingsService } from '../settings'
import { createLogger } from '../../util/logger'

const log = createLogger('backup')

const FORMAT_VERSION = 1

/** Tables included in a backup, in insert order (parents before children). */
const TABLE_ORDER = [
  'accounts',
  'folders',
  'messages',
  'attachments',
  'drafts',
  'outbox',
  'rules',
  'signatures',
  'contacts',
  'calendar_events',
  'tasks',
  'saved_searches',
  'recent_searches',
  'labels',
  'sync_queue',
  'kv'
] as const

/** Tables that hold secrets or machine specific state and are never exported. */
const EXCLUDED = new Set<string>(['credentials'])

export interface BackupContext {
  db: Db
  settings: SettingsService
}

export class BackupService {
  constructor(private readonly ctx: BackupContext) {}

  /** Writes a backup archive and returns its path. */
  async exportTo(file: string): Promise<BackupManifest> {
    const db = this.ctx.db
    const zip = new JSZip()
    const counts: Record<string, number> = {}

    for (const table of TABLE_ORDER) {
      if (EXCLUDED.has(table)) continue
      if (!this.tableExists(table)) continue
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
      counts[table] = rows.length
      zip.file(`data/${table}.json`, JSON.stringify(rows, null, 2))
    }

    const manifest: BackupManifest = {
      version: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      appVersion: this.appVersion(),
      includesPasswords: false,
      counts
    }

    zip.file('manifest.json', JSON.stringify({ format: 'novamail-backup', ...manifest }, null, 2))
    zip.file('settings.json', JSON.stringify(this.ctx.settings.get(), null, 2))
    zip.file(
      'README.txt',
      [
        'Novamail backup',
        '',
        'This archive contains your locally cached mail, folders, contacts, calendar, tasks,',
        'rules, signatures and preferences. Passwords and sign-in tokens are NOT included.',
        'Restore it from Settings -> Data & backup -> Restore from a backup.',
        '',
        `Created ${manifest.createdAt}`,
        `App version ${manifest.appVersion}`
      ].join('\n')
    )

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.partial`
    fs.writeFileSync(temporary, buffer, { mode: 0o600 })
    fs.renameSync(temporary, file)
    log.info('backup written', { file, bytes: buffer.byteLength, tables: Object.keys(counts).length })
    return manifest
  }

  /** Reads a backup archive back into the database. Returns the row counts written. */
  async importFrom(file: string): Promise<{ manifest: BackupManifest; counts: Record<string, number> }> {
    const buffer = fs.readFileSync(file)
    const zip = await JSZip.loadAsync(buffer)
    const manifestFile = zip.file('manifest.json')
    if (!manifestFile) throw new Error('This file is not a Novamail backup (manifest.json is missing).')

    let manifest: BackupManifest
    let format = ''
    try {
      const parsed = JSON.parse(await manifestFile.async('string')) as BackupManifest & { format?: string }
      manifest = parsed
      format = parsed.format ?? ''
    } catch {
      throw new Error('The backup manifest is damaged and cannot be read.')
    }
    if (format !== 'novamail-backup') throw new Error('This file is not a Novamail backup.')
    if (manifest.version > FORMAT_VERSION) {
      throw new Error(
        `This backup was made by a newer version of Novamail (format ${manifest.version}). Update Novamail first.`
      )
    }

    const counts: Record<string, number> = {}
    const db = this.ctx.db

    for (const table of TABLE_ORDER) {
      const entry = zip.file(`data/${table}.json`)
      if (!entry) continue
      if (!this.tableExists(table)) {
        log.warn('skipping backup table that this version does not have', { table })
        continue
      }
      let rows: Record<string, unknown>[]
      try {
        rows = JSON.parse(await entry.async('string')) as Record<string, unknown>[]
      } catch {
        throw new Error(`The backup table "${table}" is damaged and cannot be read.`)
      }
      if (rows.length === 0) {
        counts[table] = 0
        continue
      }

      const validColumns = new Set(this.columnsOf(table))
      const usable = rows.filter((row) => Object.keys(row).every((column) => validColumns.has(column)))
      const dropped = rows.length - usable.length
      if (dropped > 0) log.warn('backup rows with unknown columns were skipped', { table, dropped })
      if (usable.length === 0) continue

      const columns = Object.keys(usable[0]!)
      const statement = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns
          .map(() => '?')
          .join(', ')})`
      )
      const insert = db.transaction((batch: Record<string, unknown>[]) => {
        for (const row of batch) statement.run(...columns.map((column) => toSqliteValue(row[column])))
      })
      insert(usable)
      counts[table] = usable.length
    }

    const settingsFile = zip.file('settings.json')
    if (settingsFile) {
      try {
        const raw = JSON.parse(await settingsFile.async('string')) as Record<string, unknown>
        this.ctx.settings.replaceAll(raw as never)
      } catch (error) {
        log.warn('backup settings could not be restored', { error })
      }
    }

    log.info('backup restored', { file, counts })
    return { manifest, counts }
  }

  private appVersion(): string {
    try {
      // Avoids an electron import so this service stays testable in plain Node.
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
      return pkg.version ?? '1.0.0'
    } catch {
      return '1.0.0'
    }
  }

  private tableExists(table: string): boolean {
    const row = this.ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
      .get(table) as { name?: string } | undefined
    return Boolean(row?.name)
  }

  private columnsOf(table: string): string[] {
    const rows = this.ctx.db.pragma(`table_info(${table})`) as { name: string }[]
    return rows.map((row) => row.name)
  }
}

function toSqliteValue(value: unknown): string | number | null | Buffer {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (Buffer.isBuffer(value)) return value
  return JSON.stringify(value)
}
