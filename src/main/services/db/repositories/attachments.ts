/**
 * Novamail - attachment metadata repository (bytes live in the file cache).
 */
import type { AttachmentMeta, Id } from '@shared/types'
import type { Db } from '../database'
import { nowIso } from '../../../util/ids'

interface AttachmentRow {
  id: string
  message_id: string
  filename: string
  mime_type: string
  size: number
  content_id: string | null
  disposition: string
  kind: string
  cache_path: string | null
  checksum: string | null
}

export function mapAttachment(row: AttachmentRow): AttachmentMeta {
  return {
    id: row.id,
    messageId: row.message_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    contentId: row.content_id,
    disposition: row.disposition as 'attachment' | 'inline',
    kind: row.kind as AttachmentMeta['kind'],
    isInline: row.disposition === 'inline',
    checksum: row.checksum,
    cached: Boolean(row.cache_path)
  }
}

export class AttachmentsRepository {
  constructor(private readonly db: Db) {}

  get(id: Id): (AttachmentMeta & { cachePath: string | null; messageUid: number; messageAccountId: Id }) | null {
    const row = this.db
      .prepare(
        `SELECT att.*, m.uid AS message_uid, m.account_id AS message_account_id
         FROM attachments att JOIN messages m ON m.id = att.message_id WHERE att.id = ?`
      )
      .get(id) as (AttachmentRow & { message_uid: number; message_account_id: string }) | undefined
    if (!row) return null
    return {
      ...mapAttachment(row),
      cachePath: row.cache_path,
      messageUid: row.message_uid,
      messageAccountId: row.message_account_id
    }
  }

  listForMessage(messageId: Id): AttachmentMeta[] {
    const rows = this.db
      .prepare('SELECT * FROM attachments WHERE message_id = ? ORDER BY rowid')
      .all(messageId) as AttachmentRow[]
    return rows.map(mapAttachment)
  }

  markCached(id: Id, cachePath: string, checksum: string | null): void {
    this.db.prepare('UPDATE attachments SET cache_path = ?, checksum = ? WHERE id = ?').run(cachePath, checksum, id)
  }

  add(input: {
    messageId: Id
    filename: string
    mimeType: string
    size: number
    contentId: string | null
    disposition: 'attachment' | 'inline'
    kind: string
  }): AttachmentMeta {
    const id = crypto.randomUUID()
    this.db
      .prepare(
        `INSERT INTO attachments (id, message_id, filename, mime_type, size, content_id, disposition, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.messageId,
        input.filename,
        input.mimeType,
        input.size,
        input.contentId,
        input.disposition,
        input.kind,
        nowIso()
      )
    return this.get(id)!
  }

  /** Attachments whose cache entry was purged externally. */
  clearCacheReferences(): void {
    this.db.prepare('UPDATE attachments SET cache_path = NULL, checksum = NULL').run()
  }

  totalCachedBytes(): number {
    const row = this.db
      .prepare('SELECT coalesce(sum(size),0) AS total FROM attachments WHERE cache_path IS NOT NULL')
      .get() as { total: number }
    return row.total
  }
}
