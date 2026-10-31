/**
 * Novamail - attachment service.
 *
 * Bridges the attachment metadata rows, the on-disk cache and the preview engine.
 * Bytes are fetched from the server on demand (never automatically), written to
 * the managed cache, and only then handed to a viewer.
 */
import fs from 'node:fs'
import path from 'node:path'
import type {
  AttachmentDetail,
  AttachmentMeta,
  AttachmentPreview,
  Id
} from '@shared/types'
import { classifyAttachment, evaluateSafety, previewTypeFor, safeFilename } from '@shared/attachments'
import type { AttachmentsRepository } from '../db/repositories/attachments'
import { buildPreview } from './preview'
import { AttachmentCache } from './cache'
import { createLogger } from '../../util/logger'

const log = createLogger('attachments')

export interface AttachmentDownloadRequest {
  attachmentId: Id
  messageId: Id
  accountId: Id
  uid: number
  filename: string
  mimeType: string
}

export type AttachmentDownloader = (request: AttachmentDownloadRequest) => Promise<Buffer>

export interface AttachmentServiceDeps {
  repository: AttachmentsRepository
  cache: AttachmentCache
  getPreviewLimit: () => { maxBytes: number; officePreviews: boolean }
  log?: typeof log
}

export class AttachmentService {
  private downloader: AttachmentDownloader | null = null
  private readonly inflight = new Map<Id, Promise<string>>()

  constructor(private readonly deps: AttachmentServiceDeps) {}

  setDownloader(downloader: AttachmentDownloader): void {
    this.downloader = downloader
  }

  /** Path inside the managed cache for a given attachment. */
  cachePathFor(accountId: Id, messageId: Id, attachmentId: Id, filename: string): string {
    return this.deps.cache.pathFor(accountId, messageId, attachmentId, filename)
  }

  /** Writes bytes into the managed cache and returns path + checksum. */
  writeCache(target: string, content: Buffer): { path: string; checksum: string } {
    return this.deps.cache.write(target, content)
  }

  list(messageId: Id): AttachmentMeta[] {
    return this.deps.repository.listForMessage(messageId)
  }

  detail(id: Id): AttachmentDetail | null {
    const record = this.deps.repository.get(id)
    if (!record) return null
    const { type, limitation } = previewTypeFor(record.filename, record.mimeType)
    const safety = evaluateSafety(record.filename, record.mimeType)
    const limit = this.deps.getPreviewLimit()
    const canPreview = type !== 'unsupported' && record.size <= limit.maxBytes
    return {
      ...record,
      kind: classifyAttachment(record.filename, record.mimeType),
      cachePath: undefined as never,
      messageUid: undefined as never,
      messageAccountId: undefined as never,
      previewType: type,
      safety,
      canPreview,
      limitation:
        limitation ??
        (record.size > limit.maxBytes
          ? `Larger than the ${Math.round(limit.maxBytes / 1024 / 1024)} MB preview limit.`
          : null)
    } as AttachmentDetail
  }

  /** Ensures the bytes exist locally and returns the cache path. */
  async ensureCached(id: Id): Promise<string> {
    const record = this.deps.repository.get(id)
    if (!record) throw new Error('Attachment not found')
    if (record.cachePath && this.deps.cache.exists(record.cachePath)) return record.cachePath

    const existing = this.inflight.get(id)
    if (existing) return existing

    const task = (async () => {
      if (!this.downloader) throw new Error('Attachment downloads are not available right now.')
      log.info('downloading attachment into cache', { size: record.size, kind: record.kind })
      const buffer = await this.downloader({
        attachmentId: id,
        messageId: record.messageId,
        accountId: record.messageAccountId,
        uid: record.messageUid,
        filename: record.filename,
        mimeType: record.mimeType
      })
      const target = this.deps.cache.pathFor(
        record.messageAccountId,
        record.messageId,
        id,
        safeFilename(record.filename)
      )
      const { path: written, checksum } = this.deps.cache.write(target, buffer)
      this.deps.repository.markCached(id, written, checksum)
      return written
    })()

    this.inflight.set(id, task)
    try {
      return await task
    } finally {
      this.inflight.delete(id)
    }
  }

  async preview(id: Id): Promise<AttachmentPreview> {
    const record = this.deps.repository.get(id)
    if (!record) {
      return { type: 'unsupported', reason: 'This attachment no longer exists.', suggestion: 'Refresh the message.' }
    }
    const limit = this.deps.getPreviewLimit()
    const { type } = previewTypeFor(record.filename, record.mimeType)

    // Streaming viewers do not need the bytes in the main process.
    const needsBytes = !['pdf', 'image', 'audio', 'video'].includes(type)
    if (!needsBytes) {
      // Pre-download so the custom protocol can serve the file immediately.
      try {
        await this.ensureCached(id)
      } catch (error) {
        log.warn('attachment could not be downloaded for preview', { error })
        return {
          type: 'unsupported',
          reason: 'This attachment could not be downloaded. Check your connection and try again.',
          suggestion: 'Try again, or save the attachment when you are back online.'
        }
      }
    }

    let content: Buffer
    try {
      const cachePath = needsBytes ? await this.ensureCached(id) : (this.deps.repository.get(id)?.cachePath ?? '')
      content = this.deps.cache.exists(cachePath) ? this.deps.cache.read(cachePath) : Buffer.alloc(0)
    } catch (error) {
      log.warn('attachment bytes unavailable', { error })
      return {
        type: 'unsupported',
        reason: 'This attachment could not be downloaded. Check your connection and try again.',
        suggestion: 'Try again later, or save the attachment when you are back online.'
      }
    }

    return buildPreview({
      id,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
      content,
      kind: classifyAttachment(record.filename, record.mimeType),
      maxBytes: limit.maxBytes,
      officePreviews: limit.officePreviews
    })
  }

  /** Copies the attachment to a user-chosen location. */
  async exportCopy(id: Id, targetPath: string): Promise<string> {
    const cachePath = await this.ensureCached(id)
    const directory = path.dirname(targetPath)
    fs.mkdirSync(directory, { recursive: true })
    fs.copyFileSync(cachePath, targetPath)
    return targetPath
  }

  /** Writes the attachment to the managed temp folder for "open with default app". */
  async exportForExternalOpen(id: Id, tempDir: string): Promise<string> {
    const record = this.deps.repository.get(id)
    if (!record) throw new Error('Attachment not found')
    const cachePath = await this.ensureCached(id)
    fs.mkdirSync(tempDir, { recursive: true })
    const target = path.join(tempDir, safeFilename(record.filename, `attachment-${id}`))
    fs.copyFileSync(cachePath, target)
    return target
  }

  async markAllUncached(): Promise<void> {
    this.deps.repository.clearCacheReferences()
  }

  stats(): { totalCachedBytes: number } {
    return { totalCachedBytes: this.deps.repository.totalCachedBytes() }
  }

  prune(): { removed: number; bytes: number; stalePaths: string[] } {
    const result = this.deps.cache.prune()
    if (result.removed > 0) {
      const stale = new Set(result.stalePaths)
      // Metadata for purged files is reset lazily; a re-download repopulates it.
      log.debug('pruned attachments', { removed: result.removed, stale: stale.size })
    }
    return result
  }

  clearCache(): number {
    const cleared = this.deps.cache.clear()
    this.deps.repository.clearCacheReferences()
    return cleared.removed
  }
}
