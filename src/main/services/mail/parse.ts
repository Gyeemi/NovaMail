/**
 * Novamail - MIME parsing (mailparser).
 *
 * Produces a plain structure the rest of the app can store. Attachment content
 * is handed straight to the attachment cache and never written to the database.
 */
import { createHash } from 'node:crypto'
import { simpleParser } from 'mailparser'
import type { MailAddress } from '@shared/types'
import { classifyAttachment } from '@shared/attachments'

export interface ParsedAttachment {
  filename: string
  mimeType: string
  size: number
  contentId: string | null
  disposition: 'attachment' | 'inline'
  kind: string
  content: Buffer
  checksum: string | null
}

export interface ParsedMessage {
  subject: string
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  replyTo: MailAddress[]
  date: string
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  listUnsubscribe: string | null
  headers: Record<string, string>
  html: string | null
  text: string | null
  attachments: ParsedAttachment[]
  hasRemoteContent: boolean
}

function addressList(value: unknown): MailAddress[] {
  const list = value as { value?: { name?: string; address?: string }[] } | undefined
  if (!list?.value) return []
  return list.value
    .filter((entry) => Boolean(entry.address))
    .map((entry) => ({ name: entry.name ?? '', address: entry.address! }))
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function textToHtml(text: string): string {
  return `<div style="white-space:pre-wrap;font-family:inherit">${escapeHtml(text)}</div>`
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function makeSnippet(text: string | null, html: string | null, maxLength = 220): string {
  const source = (text ?? (html ? htmlToText(html) : '')).replace(/\s+/g, ' ').trim()
  if (source.length <= maxLength) return source
  return `${source.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Reads a folded header straight from the raw source. */
function rawHeaderValue(source: Buffer, name: string): string | null {
  const head = source.subarray(0, Math.min(source.length, 32_768)).toString('utf8')
  const end = head.search(/\r?\n\r?\n/)
  const block = end >= 0 ? head.slice(0, end) : head
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ')
  const regex = new RegExp(`^${name}\\s*:\\s*(.+)$`, 'im')
  const match = regex.exec(unfolded)
  return match ? match[1]!.trim() : null
}

export async function parseRawMessage(source: Buffer): Promise<ParsedMessage> {
  const parsed = await simpleParser(source, { skipHtmlToText: false, skipTextToHtml: true })

  const headers: Record<string, string> = {}
  for (const [key, value] of parsed.headers) {
    if (typeof value === 'string') headers[key.toLowerCase()] = value
    else if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
      headers[key.toLowerCase()] = String((value as { value: unknown }).value)
    } else if (Array.isArray(value)) {
      headers[key.toLowerCase()] = value
        .map((v) => (typeof v === 'string' ? v : (v as { address?: string }).address ?? ''))
        .join(', ')
    }
  }

  const attachments: ParsedAttachment[] = (parsed.attachments ?? []).map((attachment) => {
    const filename = attachment.filename ?? `attachment-${Math.random().toString(36).slice(2, 8)}`
    const disposition = (attachment.contentDisposition ?? '').toLowerCase().includes('inline')
      ? ('inline' as const)
      : ('attachment' as const)
    return {
      filename,
      mimeType: attachment.contentType ?? 'application/octet-stream',
      size: attachment.size ?? attachment.content?.length ?? 0,
      contentId: attachment.cid ? attachment.cid.replace(/^<|>$/g, '') : null,
      disposition,
      kind: classifyAttachment(filename, attachment.contentType ?? ''),
      content: attachment.content as Buffer,
      // Always our own digest (mailparser's is MD5) so dedupe is consistent.
      checksum: sha256(attachment.content ?? Buffer.alloc(0))
    }
  })

  const html = typeof parsed.html === 'string' ? parsed.html : null
  const text = parsed.text ?? null
  // mailparser normalises some list headers into objects, so fall back to the raw
  // header block to be sure an unsubscribe option is never missed.
  const listUnsubscribe =
    headers['list-unsubscribe'] ??
    rawHeaderValue(source, 'list-unsubscribe') ??
    rawHeaderValue(source, 'list-post') ??
    null

  return {
    subject: parsed.subject ?? '',
    from: {
      name: addressList(parsed.from)[0]?.name ?? '',
      address: addressList(parsed.from)[0]?.address ?? ''
    },
    to: addressList(parsed.to),
    cc: addressList(parsed.cc),
    bcc: addressList(parsed.bcc),
    replyTo: addressList(parsed.replyTo),
    date: (parsed.date ?? new Date()).toISOString(),
    messageId: parsed.messageId ? parsed.messageId.replace(/^<|>$/g, '') : null,
    inReplyTo: parsed.inReplyTo ? parsed.inReplyTo.replace(/^<|>$/g, '') : null,
    references: Array.isArray(parsed.references)
      ? parsed.references.map((r) => r.replace(/^<|>$/g, ''))
      : parsed.references
        ? [String(parsed.references).replace(/^<|>$/g, '')]
        : [],
    listUnsubscribe,
    headers,
    html: html ?? (text ? textToHtml(text) : null),
    text: text ?? (html ? htmlToText(html) : null),
    attachments,
    hasRemoteContent: Boolean(html && /(src|background)=["']?(https?:)?\/\//i.test(html))
  }
}
