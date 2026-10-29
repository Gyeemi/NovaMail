/**
 * Novamail - attachment cache.
 *
 * Attachment bytes live in an application-managed cache directory, never in the
 * database and never in the installation folder. Files are written atomically,
 * with restrictive permissions, and pruned by age and total size.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { safeFilename } from '@shared/attachments'
import { createLogger } from '../../util/logger'

const log = createLogger('attachment-cache')

export interface CacheOptions {
  retentionDays: number
  maxTotalBytes: number
}

export class AttachmentCache {
  private options: CacheOptions

  constructor(
    private readonly root: string,
    options: CacheOptions
  ) {
    this.options = options
    fs.mkdirSync(root, { recursive: true })
  }

  setOptions(options: Partial<CacheOptions>): void {
    this.options = { ...this.options, ...options }
  }

  get directory(): string {
    return this.root
  }

  /** Deterministic, traversal-safe path: root/account/message/attachment__name */
  pathFor(accountId: string, messageId: string, attachmentId: string, filename: string): string {
    const safeAccount = this.sanitizeSegment(accountId)
    const safeMessage = this.sanitizeSegment(messageId)
    const safeAttachment = this.sanitizeSegment(attachmentId)
    const name = safeFilename(filename, 'attachment')
    return path.join(this.root, safeAccount, safeMessage, `${safeAttachment}__${name}`)
  }

  private sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  }

  /** Writes bytes and returns the path plus a SHA-256 checksum. */
  write(target: string, content: Buffer): { path: string; checksum: string } {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.part`
    fs.writeFileSync(tmp, content, { mode: 0o600 })
    fs.renameSync(tmp, target)
    const checksum = createHash('sha256').update(content).digest('hex')
    return { path: target, checksum }
  }

  read(filePath: string): Buffer {
    return fs.readFileSync(filePath)
  }

  exists(filePath: string | null | undefined): boolean {
    if (!filePath) return false
    try {
      return fs.statSync(filePath).isFile()
    } catch {
      return false
    }
  }

  /** Ensures a path stays inside the cache root (defence against path traversal). */
  isInsideCache(filePath: string): boolean {
    const resolved = path.resolve(filePath)
    const root = path.resolve(this.root)
    return resolved === root || resolved.startsWith(`${root}${path.sep}`)
  }

  totalBytes(): number {
    let total = 0
    const walk = (dir: string): void => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else {
          try {
            total += fs.statSync(full).size
          } catch {
            /* ignore */
          }
        }
      }
    }
    walk(this.root)
    return total
  }

  /** Deletes files older than the retention window, then trims to the size budget. */
  prune(now = Date.now()): { removed: number; bytes: number; stalePaths: string[] } {
    const cutoff = now - this.options.retentionDays * 86_400_000
    const files: { file: string; size: number; mtime: number }[] = []
    const walk = (dir: string): void => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else {
          try {
            const stat = fs.statSync(full)
            files.push({ file: full, size: stat.size, mtime: stat.mtimeMs })
          } catch {
            /* ignore */
          }
        }
      }
    }
    walk(this.root)

    let removed = 0
    let bytes = 0
    const stalePaths: string[] = []

    const drop = (entry: { file: string; size: number }): void => {
      try {
        fs.rmSync(entry.file, { force: true })
        removed += 1
        bytes += entry.size
        stalePaths.push(entry.file)
      } catch {
        /* ignore */
      }
    }

    const survivors: typeof files = []
    for (const entry of files) {
      if (entry.mtime < cutoff) drop(entry)
      else survivors.push(entry)
    }

    let total = survivors.reduce((sum, entry) => sum + entry.size, 0)
    if (total > this.options.maxTotalBytes) {
      survivors.sort((a, b) => a.mtime - b.mtime)
      for (const entry of survivors) {
        if (total <= this.options.maxTotalBytes) break
        drop(entry)
        total -= entry.size
      }
    }

    // remove empty directories
    const pruneEmpty = (dir: string): void => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.isDirectory()) pruneEmpty(path.join(dir, entry.name))
      }
      try {
        if (dir !== this.root && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
      } catch {
        /* ignore */
      }
    }
    pruneEmpty(this.root)

    if (removed > 0) log.info('attachment cache pruned', { removed, bytes })
    return { removed, bytes, stalePaths }
  }

  clear(): { removed: number; bytes: number } {
    let removed = 0
    let bytes = 0
    const walk = (dir: string): void => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          try {
            fs.rmdirSync(full)
          } catch {
            /* ignore */
          }
        } else {
          try {
            bytes += fs.statSync(full).size
            fs.rmSync(full, { force: true })
            removed += 1
          } catch {
            /* ignore */
          }
        }
      }
    }
    walk(this.root)
    return { removed, bytes }
  }
}
