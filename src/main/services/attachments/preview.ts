/**
 * Novamail - attachment preview engine.
 *
 * Everything is rendered locally from the attachment cache; nothing is uploaded
 * to a third-party service. Where a format cannot be rendered faithfully we say
 * so instead of showing a broken viewer.
 *
 *  PDF / images / audio / video -> streamed to the UI through a private protocol
 *  text / csv                   -> plain text and a real table preview
 *  DOCX                          -> HTML via mammoth, then sanitised like email
 *  XLSX                          -> cell data via exceljs
 *  PPTX                          -> slide text + embedded images via jszip
 *  EML                           -> parsed with mailparser, sanitised
 */
import type { AttachmentKind, AttachmentPreview, PreviewType } from '@shared/types'
import { previewTypeFor } from '@shared/attachments'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { sanitizeEmailHtml } from '../mail/sanitize'
import { htmlToText, parseRawMessage } from '../mail/parse'
import { createLogger } from '../../util/logger'

const log = createLogger('preview')

export const ATTACHMENT_SCHEME = 'novamail-att'
export const MAX_TEXT_PREVIEW_BYTES = 512 * 1024
export const MAX_TABLE_ROWS = 300
export const MAX_TABLE_COLS = 30
export const MAX_SLIDES = 60
export const MAX_INLINE_DOCX_IMAGES = 40

export function attachmentUrl(attachmentId: string): string {
  return `${ATTACHMENT_SCHEME}://attachment/${attachmentId}`
}

export interface PreviewInput {
  id: string
  filename: string
  mimeType: string
  size: number
  content: Buffer
  kind: AttachmentKind
  maxBytes: number
  officePreviews: boolean
}

/** Decodes text safely, honouring UTF-16 BOMs and falling back to Latin-1. */
export function decodeText(buffer: Buffer, limit = MAX_TEXT_PREVIEW_BYTES): { text: string; truncated: boolean } {
  const slice = buffer.subarray(0, limit)
  const truncated = buffer.length > limit
  let text: string
  if (slice[0] === 0xff && slice[1] === 0xfe) text = slice.subarray(2).toString('utf16le')
  else if (slice[0] === 0xfe && slice[1] === 0xff) {
    const swapped = Buffer.from(slice.subarray(2))
    swapped.swap16()
    text = swapped.toString('utf16le')
  } else {
    text = slice.toString('utf8')
    const replacementRatio = (text.match(/\uFFFD/g)?.length ?? 0) / Math.max(text.length, 1)
    if (replacementRatio > 0.05) text = slice.toString('latin1')
  }
  return { text: text.replace(/^\uFEFF/, ''), truncated }
}

export function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 1024)
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}

/** Minimal RFC 4180 CSV parser (handles quotes, embedded newlines and CRLF). */
export function parseCsv(text: string, maxRows = MAX_TABLE_ROWS, maxCols = MAX_TABLE_COLS): {
  rows: string[][]
  truncatedRows: boolean
  truncatedCols: boolean
} {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let truncatedCols = false
  const delimiter = detectDelimiter(text)

  const pushField = (): void => {
    if (row.length < maxCols) row.push(field)
    else truncatedCols = true
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    if (rows.length < maxRows) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === delimiter) {
      pushField()
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      pushRow()
      if (rows.length >= maxRows) return { rows, truncatedRows: true, truncatedCols }
      continue
    }
    field += char
  }
  if (field.length > 0 || row.length > 0) pushRow()
  const truncatedRows = text.split('\n').length > maxRows
  return { rows, truncatedRows, truncatedCols }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestCount = 0
  for (const candidate of candidates) {
    const count = (firstLine.match(new RegExp(candidate === '\t' ? '\\t' : `\\${candidate}`, 'g')) ?? []).length
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ')
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return value
  const item = value as Record<string, unknown>
  if (typeof item.text === 'string') return item.text
  if (Array.isArray(item.richText)) {
    return (item.richText as { text?: string }[]).map((part) => part.text ?? '').join('')
  }
  if (item.result !== undefined) return cellToString(item.result)
  if (item.hyperlink && item.text) return String(item.text)
  if (item.error) return `#${String(item.error)}`
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export function rowsToSpreadsheetPreview(
  filename: string,
  rows: string[][],
  truncatedRows: boolean,
  truncatedCols: boolean,
  warnings: string[] = []
): AttachmentPreview {
  return {
    type: 'spreadsheet',
    sheets: [
      {
        name: filename.replace(/\.[^.]+$/, '').slice(0, 40) || 'Table',
        rows: rows.map((row) => row.map(cellToString)),
        truncatedRows,
        truncatedCols
      }
    ],
    warnings
  }
}

async function previewDocument(input: PreviewInput, html: string, warnings: string[] = []): Promise<AttachmentPreview> {
  const cleaned = sanitizeEmailHtml(html, { allowRemoteImages: false })
  return {
    type: html.length > 0 ? 'html' : 'unsupported',
    html: cleaned.html,
    warnings: [
      ...warnings,
      ...(cleaned.removedActiveContent ? ['Active content was removed from this document for your safety.'] : [])
    ]
  } as AttachmentPreview
}

async function previewDocx(input: PreviewInput): Promise<AttachmentPreview> {
  const result = await mammoth.convertToHtml(
    { buffer: input.content },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read('base64')
        return { src: `data:${image.contentType};base64,${base64}`, alt: '' }
      }),
      styleMap: ['p[style-name="Heading 1"] => h1:fresh', 'p[style-name="Heading 2"] => h2:fresh']
    }
  )
  const warnings = [
    'Layout, headers and footers are simplified by the local renderer. Open the file in Word for exact formatting.'
  ]
  if (result.messages.length > 0) {
    log.debug('docx conversion messages', { count: result.messages.length })
  }
  return previewDocument(input, result.value, warnings)
}

async function previewXlsx(input: PreviewInput): Promise<AttachmentPreview> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(input.content as unknown as ArrayBuffer)
  const sheets: {
    name: string
    rows: string[][]
    truncatedRows: boolean
    truncatedCols: boolean
  }[] = []

  const worksheets = workbook.worksheets.slice(0, 5)
  for (const worksheet of worksheets) {
    const rows: string[][] = []
    let truncatedCols = false
    let rowCount = 0
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (rowCount >= MAX_TABLE_ROWS) return
      const values: string[] = []
      for (let col = 1; col <= Math.min(worksheet.columnCount, MAX_TABLE_COLS); col += 1) {
        values.push(cellToString(row.getCell(col).value))
      }
      if (worksheet.columnCount > MAX_TABLE_COLS) truncatedCols = true
      rows.push(values)
      rowCount += 1
    })
    sheets.push({
      name: worksheet.name,
      rows,
      truncatedRows: worksheet.rowCount > MAX_TABLE_ROWS,
      truncatedCols
    })
  }

  const warnings: string[] = []
  if (workbook.worksheets.length > worksheets.length) {
    warnings.push(`Only the first ${worksheets.length} worksheets are shown.`)
  }
  if (workbook.worksheets.length === 0) warnings.push('This workbook contains no worksheets.')
  warnings.push('Formulas are shown as their last calculated values; charts and formatting are not rendered.')

  return { type: 'spreadsheet', sheets, warnings }
}

async function previewPptx(input: PreviewInput): Promise<AttachmentPreview> {
  const zip = await JSZip.loadAsync(input.content)
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml/.exec(a)?.[1] ?? 0)
      const nb = Number(/slide(\d+)\.xml/.exec(b)?.[1] ?? 0)
      return na - nb
    })
    .slice(0, MAX_SLIDES)

  const slides: { index: number; title: string; lines: string[]; imageDataUrls: string[] }[] = []
  const warnings: string[] = []

  for (const [index, name] of slideNames.entries()) {
    const xml = await zip.file(name)?.async('string')
    if (!xml) continue
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      m[1]!
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim()
    )
    const imageDataUrls: string[] = []
    const relsName = name.replace('slides/', 'slides/_rels/') + '.rels'
    const rels = await zip.file(relsName)?.async('string')
    if (rels) {
      const targets = [...rels.matchAll(/Target="([^"]*media\/[^"]+)"/g)]
        .map((m) => m[1]!.replace(/^\.\.\//, 'ppt/'))
        .slice(0, 6)
      for (const target of targets) {
        const media = zip.file(target)
        if (!media) continue
        const extension = target.split('.').pop()?.toLowerCase() ?? ''
        const mime =
          extension === 'png'
            ? 'image/png'
            : extension === 'jpg' || extension === 'jpeg'
              ? 'image/jpeg'
              : extension === 'gif'
                ? 'image/gif'
                : extension === 'svg'
                  ? 'image/svg+xml'
                  : null
        if (!mime) continue
        const base64 = await media.async('base64')
        if (base64.length > 4_000_000) continue
        imageDataUrls.push(`data:${mime};base64,${base64}`)
      }
    }
    slides.push({
      index: index + 1,
      title: texts[0] ?? `Slide ${index + 1}`,
      lines: texts.slice(1),
      imageDataUrls
    })
  }

  if (slides.length === 0) {
    warnings.push('This presentation contains no readable slide text.')
  }
  warnings.push(
    'Slides are shown as text and pictures. Animations, charts and exact layout are not reproduced — open the file in PowerPoint for the original design.'
  )
  return { type: 'slides', slides, warnings }
}

async function previewEmail(input: PreviewInput): Promise<AttachmentPreview> {
  const parsed = await parseRawMessage(input.content)
  const sanitized = sanitizeEmailHtml(parsed.html ?? '<p>(no content)</p>', { allowRemoteImages: false })
  const warnings: string[] = [
    'This is an attached message. It is displayed in a read-only, script-free view.'
  ]
  if (sanitized.blockedRemoteCount > 0) {
    warnings.push(`${sanitized.blockedRemoteCount} remote image(s) were blocked.`)
  }
  if (parsed.attachments.length > 0) {
    warnings.push(`The attached message contains ${parsed.attachments.length} further attachment(s).`)
  }
  const header = `
    <div style="border:1px solid #d7e0e6;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:14px;line-height:1.6">
      <div><strong>Subject:</strong> ${escapeHtml(parsed.subject || '(no subject)')}</div>
      <div><strong>From:</strong> ${escapeHtml(parsed.from.name ? `${parsed.from.name} <${parsed.from.address}>` : parsed.from.address)}</div>
      <div><strong>Date:</strong> ${escapeHtml(parsed.date)}</div>
    </div>`
  return { type: 'email', html: header + sanitized.html, warnings }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Public entry point: decides which viewer to use and returns structured data. */
export async function buildPreview(input: PreviewInput): Promise<AttachmentPreview> {
  const { type, limitation } = previewTypeFor(input.filename, input.mimeType)

  if (input.size > input.maxBytes) {
    return {
      type: 'unsupported',
      reason: `This file is ${Math.round(input.size / 1024 / 1024)} MB, which is larger than the preview limit of ${Math.round(
        input.maxBytes / 1024 / 1024
      )} MB. You can save it or open it with another app.`,
      suggestion: 'Save the file, or raise the preview limit in Settings > Attachments.'
    }
  }

  if (type === 'unsupported' || limitation?.startsWith('Executable')) {
    return {
      type: 'unsupported',
      reason: limitation ?? 'Novamail has no built-in viewer for this file type.',
      suggestion: input.kind === 'archive' ? 'Save it and extract it with a trusted tool.' : 'Save it or open it with another app.'
    }
  }

  try {
    switch (type) {
      case 'pdf':
        return { type: 'pdf', url: attachmentUrl(input.id), mimeType: input.mimeType || 'application/pdf' }
      case 'image':
        return { type: 'image', url: attachmentUrl(input.id), mimeType: input.mimeType }
      case 'audio':
        return { type: 'audio', url: attachmentUrl(input.id), mimeType: input.mimeType }
      case 'video':
        return { type: 'video', url: attachmentUrl(input.id), mimeType: input.mimeType }
      case 'text': {
        if (looksBinary(input.content)) {
          return {
            type: 'unsupported',
            reason: 'This file looks like binary data rather than text.',
            suggestion: 'Save the file and open it with a suitable application.'
          }
        }
        const { text, truncated } = decodeText(input.content)
        return {
          type: 'text',
          text,
          truncated,
          lines: text.split(/\r?\n/).length,
          language: /\.(json)$/i.test(input.filename) ? 'json' : 'plain'
        }
      }
      case 'spreadsheet': {
        if (input.kind === 'csv') {
          const { text } = decodeText(input.content)
          const { rows, truncatedRows, truncatedCols } = parseCsv(text)
          return rowsToSpreadsheetPreview(input.filename, rows, truncatedRows, truncatedCols, [
            truncatedRows ? `Only the first ${MAX_TABLE_ROWS} rows are shown.` : '',
            truncatedCols ? `Only the first ${MAX_TABLE_COLS} columns are shown.` : ''
          ].filter(Boolean))
        }
        if (!input.officePreviews) {
          return {
            type: 'unsupported',
            reason: 'Office document previews are turned off in Settings.',
            suggestion: 'Enable "Preview Office documents" in Settings > Attachments.'
          }
        }
        return await previewXlsx(input)
      }
      case 'html': {
        if (!input.officePreviews) {
          return {
            type: 'unsupported',
            reason: 'Office document previews are turned off in Settings.',
            suggestion: 'Enable "Preview Office documents" in Settings > Attachments.'
          }
        }
        return await previewDocx(input)
      }
      case 'slides': {
        if (!input.officePreviews) {
          return {
            type: 'unsupported',
            reason: 'Office document previews are turned off in Settings.',
            suggestion: 'Enable "Preview Office documents" in Settings > Attachments.'
          }
        }
        return await previewPptx(input)
      }
      case 'email':
        return await previewEmail(input)
      default:
        return {
          type: 'unsupported',
          reason: limitation ?? 'No preview is available for this file type.',
          suggestion: 'Save the file or open it with another app.'
        }
    }
  } catch (error) {
    log.error('preview generation failed', { mimeType: input.mimeType, size: input.size, error })
    return {
      type: 'unsupported',
      reason: 'The preview could not be created. The file may be damaged or use an unsupported layout.',
      suggestion: 'Save the file and open it with the application that created it.'
    }
  }
}

export function previewSummary(kind: AttachmentKind, filename: string): { label: string; description: string } {
  const { type } = previewTypeFor(filename, '')
  const labels: Record<PreviewType, string> = {
    pdf: 'PDF document',
    image: 'Picture',
    text: 'Text file',
    html: 'Word document',
    spreadsheet: 'Spreadsheet',
    slides: 'Presentation',
    audio: 'Audio',
    video: 'Video',
    email: 'Attached message',
    unsupported: 'File'
  }
  return { label: labels[type] ?? 'File', description: htmlToText(filename) }
}
