/**
 * Novamail - search query parsing.
 *
 * Supports Gmail/Outlook style operators:
 *   from:anna  to:me  subject:invoice  body:receipt  has:attachment
 *   is:unread  is:starred  is:important  after:2024-01-31  before:2024-03-01
 *   account:work@example.com  in:archive  folder:Sent  label:Finance
 *   larger:2M  filename:pdf  "exact phrase"
 */
import type { SearchParams } from '@shared/types'

export interface ParsedQuery {
  freeText: string
  tokens: string[]
  from: string[]
  to: string[]
  subject: string[]
  body: string[]
  hasAttachment: boolean
  unreadOnly: boolean
  readOnly: boolean
  starredOnly: boolean
  importantOnly: boolean
  after?: string
  before?: string
  account?: string
  mailbox?: string
  label?: string
  filename?: string
  largerThan?: number
  errors: string[]
}

const OPERATOR = /^(from|to|cc|subject|body|has|is|after|before|on|account|in|folder|label|larger|filename):(.+)$/i

export function parseSearchQuery(input: string): ParsedQuery {
  const result: ParsedQuery = {
    freeText: '',
    tokens: [],
    from: [],
    to: [],
    subject: [],
    body: [],
    hasAttachment: false,
    unreadOnly: false,
    readOnly: false,
    starredOnly: false,
    importantOnly: false,
    errors: []
  }

  const raw = input.trim()
  if (!raw) return result

  const words = tokenize(raw)
  const free: string[] = []

  for (const word of words) {
    const quoted = word.startsWith('"') && word.endsWith('"') && word.length > 1
    const bare = quoted ? word.slice(1, -1) : word
    const match = quoted ? null : OPERATOR.exec(bare)
    if (!match) {
      if (!quoted && /^(from|to|cc|subject|body|has|is|after|before|on|account|in|folder|label|larger|filename):$/i.test(bare)) {
        result.errors.push(`Missing value for "${bare.toLowerCase()}"`)
        continue
      }
      free.push(bare)
      continue
    }
    const [, operatorRaw, valueRaw] = match
    const operator = operatorRaw!.toLowerCase()
    const value = valueRaw!.trim()
    if (!value) {
      result.errors.push(`Missing value for "${operator}:"`)
      continue
    }
    switch (operator) {
      case 'from':
        result.from.push(value)
        break
      case 'to':
      case 'cc':
        result.to.push(value)
        break
      case 'subject':
        result.subject.push(value)
        break
      case 'body':
        result.body.push(value)
        break
      case 'has':
        if (/^(attachment|attachments|file|files)$/i.test(value)) result.hasAttachment = true
        else result.errors.push(`Unknown value for has: "${value}" (try has:attachment)`)
        break
      case 'is': {
        const normalized = value.toLowerCase()
        if (normalized === 'unread') result.unreadOnly = true
        else if (normalized === 'read') result.readOnly = true
        else if (normalized === 'starred') result.starredOnly = true
        else if (normalized === 'important') result.importantOnly = true
        else result.errors.push(`Unknown value for is: "${value}" (try is:unread, is:starred)`)
        break
      }
      case 'after':
      case 'before':
      case 'on': {
        const iso = normalizeDate(value)
        if (!iso) {
          result.errors.push(`Could not understand the date "${value}" (use 2024-03-01)`)
          break
        }
        if (operator === 'after') result.after = iso
        else if (operator === 'before') result.before = iso
        else {
          result.after = `${iso}T00:00:00.000Z`
          result.before = `${iso}T23:59:59.999Z`
        }
        break
      }
      case 'account':
        result.account = value
        break
      case 'in':
      case 'folder':
        result.mailbox = value
        break
      case 'label':
        result.label = value
        break
      case 'larger': {
        const bytes = parseSize(value)
        if (bytes === null) result.errors.push(`Could not understand size "${value}" (use larger:2M)`)
        else result.largerThan = bytes
        break
      }
      case 'filename':
        result.filename = value
        break
      default:
        free.push(bare)
    }
  }

  result.tokens = free
  result.freeText = free.join(' ')
  return result
}

function tokenize(input: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes
      current += char
      continue
    }
    if (!inQuotes && /\s/.test(char)) {
      if (current) out.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) out.push(current)
  return out
}

export function normalizeDate(value: string): string | null {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // Friendly relative words, resolved in local time then expressed as ISO dates.
  const dayStart = (offsetDays: number): string => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + offsetDays)
    return d.toISOString().slice(0, 10)
  }
  const relative = /^(today|yesterday|(\d+)\s*(day|days|week|weeks|month|months)\s*ago)$/i.exec(trimmed)
  if (relative) {
    const word = relative[1]!.toLowerCase()
    if (word === 'today') return dayStart(0)
    if (word === 'yesterday') return dayStart(-1)
    const amount = Number(relative[2])
    const unit = relative[3]!.toLowerCase()
    const days = unit.startsWith('day') ? amount : unit.startsWith('week') ? amount * 7 : amount * 30
    return dayStart(-days)
  }
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(trimmed)
  if (slash) {
    const [, a, b, year] = slash
    const iso = new Date(Date.UTC(Number(year), Number(a) - 1, Number(b)))
    if (!Number.isNaN(iso.getTime())) return iso.toISOString()
  }
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  return null
}

export function parseSize(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)?$/i.exec(value.trim())
  if (!match) return null
  const amount = Number(match[1])
  const unit = (match[2] ?? 'b').toLowerCase()
  const multiplier =
    unit === 'k' || unit === 'kb'
      ? 1024
      : unit === 'm' || unit === 'mb'
        ? 1024 * 1024
        : unit === 'g' || unit === 'gb'
          ? 1024 * 1024 * 1024
          : 1
  return Math.round(amount * multiplier)
}

/**
 * Converts free text into a safe FTS5 MATCH expression.
 * Every token is quoted so user input can never break out into FTS syntax.
 */
export function buildFtsMatch(text: string): string | null {
  // Drop operator words entirely: inside a quoted phrase FTS5 would still read a
  // bare NOT/OR/AND as syntax in some builds, and they carry no meaning here.
  const tokens = tokenize(text)
    .map((t) => (t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t))
    .map((t) => t.trim())
    .filter((t) => t && !/^(and|or|not|near)$/i.test(t))
    .slice(0, 12)
  if (tokens.length === 0) return null
  const expression = tokens
    .map((token) => {
      const cleaned = token.replace(/["*^:()-]/g, ' ').trim()
      if (!cleaned) return null
      const words = cleaned.split(/\s+/).filter(Boolean)
      return words.map((w) => `"${w}"*`).join(' ')
    })
    .filter(Boolean)
    .join(' ')
  return expression.length > 0 ? expression : null
}

export function parsedToSearchParams(parsed: ParsedQuery, base?: Partial<SearchParams>): SearchParams {
  const q = [
    parsed.freeText,
    ...parsed.from.map((v) => `from:${v}`),
    ...parsed.to.map((v) => `to:${v}`),
    ...parsed.subject.map((v) => `subject:${v}`)
  ]
    .filter(Boolean)
    .join(' ')
  return {
    q,
    accountId: parsed.account ?? base?.accountId ?? 'all',
    mailbox: parsed.mailbox ?? base?.mailbox,
    from: parsed.from[0],
    to: parsed.to[0],
    subject: parsed.subject[0],
    hasAttachment: parsed.hasAttachment || base?.hasAttachment,
    afterDate: parsed.after,
    beforeDate: parsed.before,
    unreadOnly: parsed.unreadOnly,
    starredOnly: parsed.starredOnly,
    limit: base?.limit ?? 100,
    offset: base?.offset ?? 0
  }
}
