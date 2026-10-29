/**
 * Novamail - IPC payload validation.
 *
 * Every payload that crosses the bridge is parsed here before a service sees it.
 * The renderer is treated as untrusted (it may be compromised by a malicious
 * email), so the main process validates shapes, lengths and URL schemes.
 */
import { z } from 'zod'

const id = z.string().min(1).max(200)
const ids = z.array(id).min(1).max(2000)
const isoTimestamp = z.string().min(10).max(40)
const safeText = (max: number) => z.string().max(max)

export const addressSchema = z.object({
  name: safeText(200),
  address: z.string().max(320)
})

export const idsSchema = ids
export const idSchema = id

export const messageListQuerySchema = z.object({
  mailbox: z.string().min(1).max(300),
  accountId: z.string().max(200).optional(),
  sort: z.enum(['date', 'sender', 'subject', 'size']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  unreadOnly: z.boolean().optional(),
  starredOnly: z.boolean().optional(),
  attachmentsOnly: z.boolean().optional(),
  focusedOnly: z.boolean().optional(),
  otherOnly: z.boolean().optional(),
  search: z.string().max(500).optional(),
  label: z.string().max(120).optional(),
  fromFilter: z.string().max(320).optional(),
  toFilter: z.string().max(320).optional(),
  subjectFilter: z.string().max(320).optional(),
  filenameFilter: z.string().max(320).optional(),
  minSize: z.number().int().min(0).optional(),
  fromDate: isoTimestamp.optional(),
  toDate: isoTimestamp.optional(),
  includeSnoozed: z.boolean().optional(),
  includeDeleted: z.boolean().optional()
})

export const setFlagSchema = z.object({
  ids,
  field: z.enum(['isRead', 'isStarred', 'isImportant']),
  value: z.boolean()
})

export const labelArgsSchema = z.object({ ids, label: z.string().min(1).max(120) })
export const moveArgsSchema = z.object({ ids, folderId: id })
export const snoozeArgsSchema = z.object({ ids, until: isoTimestamp })

export const serverConfigSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean()
})

export const accountDraftSchema = z.object({
  id: id.optional(),
  email: z.string().min(3).max(320),
  displayName: safeText(200),
  providerId: z.enum(['gmail', 'microsoft365', 'outlook', 'icloud', 'yahoo', 'generic']),
  authType: z.enum(['oauth2', 'password']),
  username: z.string().min(1).max(320),
  imap: serverConfigSchema,
  smtp: serverConfigSchema,
  password: z.string().max(1024).optional(),
  oauthProvider: z.enum(['google', 'microsoft']).nullable().optional(),
  color: z.string().max(20).optional()
})

export const composePayloadSchema = z.object({
  mode: z.enum(['new', 'reply', 'replyAll', 'forward', 'redirect', 'draft']),
  draftId: id.optional(),
  accountId: id,
  to: z.array(addressSchema).max(500),
  cc: z.array(addressSchema).max(500),
  bcc: z.array(addressSchema).max(500),
  subject: safeText(1000),
  html: z.string().max(4_000_000),
  text: z.string().max(4_000_000),
  attachments: z
    .array(
      z.object({
        path: z.string().max(4096),
        name: z.string().max(255),
        size: z.number().int().min(0),
        mimeType: z.string().max(160),
        isInline: z.boolean().optional(),
        contentId: z.string().max(300).optional()
      })
    )
    .max(200),
  inReplyTo: z.string().max(1000).nullable(),
  references: z.array(z.string().max(1000)).max(200),
  importance: z.enum(['low', 'normal', 'high']),
  requestReadReceipt: z.boolean(),
  redirectTo: addressSchema.nullable().optional(),
  scheduledAt: z.string().max(40).nullable().optional(),
  signatureId: z.string().max(200).nullable().optional()
})

export const searchParamsSchema = z.object({
  q: z.string().max(1000),
  accountId: z.string().max(200).optional(),
  mailbox: z.string().max(300).optional(),
  from: z.string().max(320).optional(),
  to: z.string().max(320).optional(),
  subject: z.string().max(320).optional(),
  hasAttachment: z.boolean().optional(),
  afterDate: z.string().max(40).optional(),
  beforeDate: z.string().max(40).optional(),
  unreadOnly: z.boolean().optional(),
  starredOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(300).optional(),
  offset: z.number().int().min(0).optional()
})

export const ruleSchema = z.object({
  id: z.string().max(200),
  accountId: z.string().max(200).nullable(),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  matchAll: z.boolean(),
  conditions: z
    .array(
      z.object({
        field: z.enum(['from', 'to', 'subject', 'body', 'hasAttachment', 'account']),
        operator: z.enum(['contains', 'notContains', 'equals', 'matches', 'is']),
        value: z.string().max(500)
      })
    )
    .max(20),
  actions: z
    .array(
      z.object({
        type: z.enum(['move', 'label', 'markRead', 'star', 'delete', 'forward']),
        value: z.string().max(500)
      })
    )
    .max(20),
  stopProcessing: z.boolean(),
  createdAt: z.string().max(40),
  matchCount: z.number().int().min(0).optional()
})

export const contactSchema = z.object({
  id: z.string().max(200),
  accountId: z.string().max(200).nullable(),
  displayName: z.string().min(1).max(200),
  emails: z.array(z.string().max(320)).max(20),
  phone: z.string().max(60).nullable(),
  company: z.string().max(200).nullable(),
  notes: z.string().max(4000).nullable(),
  isFavorite: z.boolean(),
  groups: z.array(z.string().max(80)).max(30),
  lastUsedAt: z.string().max(40).nullable(),
  source: z.enum(['local', 'collected', 'google', 'microsoft', 'carddav'])
})

export const calendarEventSchema = z.object({
  id: z.string().max(200),
  accountId: z.string().max(200).nullable(),
  calendarName: z.string().max(120),
  title: z.string().min(1).max(300),
  description: z.string().max(20000),
  location: z.string().max(300),
  start: z.string().max(40),
  end: z.string().max(40),
  allDay: z.boolean(),
  attendees: z
    .array(
      z.object({
        email: z.string().max(320),
        name: z.string().max(200),
        role: z.enum(['organizer', 'required', 'optional']),
        status: z.enum(['needs-action', 'accepted', 'declined', 'tentative', 'delegated'])
      })
    )
    .max(200),
  organizer: z.string().max(320).nullable(),
  isRecurring: z.boolean(),
  recurrenceRule: z.string().max(1000).nullable(),
  reminderMinutes: z.number().int().min(0).max(10080).nullable(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']),
  myResponse: z.enum(['needs-action', 'accepted', 'declined', 'tentative']),
  source: z.enum(['local', 'imip', 'google', 'microsoft'])
})

export const taskSchema = z.object({
  id: z.string().max(200),
  accountId: z.string().max(200).nullable(),
  title: z.string().min(1).max(300),
  notes: z.string().max(20000),
  due: z.string().max(40).nullable(),
  completed: z.boolean(),
  priority: z.enum(['low', 'normal', 'high']),
  reminderAt: z.string().max(40).nullable(),
  createdAt: z.string().max(40),
  finishedAt: z.string().max(40).nullable()
})

export const signatureSchema = z.object({
  id: z.string().max(200),
  accountId: z.string().max(200).nullable(),
  name: z.string().min(1).max(120),
  html: z.string().max(50000),
  isDefault: z.boolean()
})

export const settingsPatchSchema = z.record(z.string(), z.unknown())

export const urlSchema = z.string().max(2048)
export const pathSchema = z.string().min(1).max(4096)

/** Only allow opening these schemes in the OS browser. */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)
  } catch {
    return false
  }
}
