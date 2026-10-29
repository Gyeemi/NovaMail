/**
 * Novamail - SMTP transport (nodemailer).
 *
 * Messages are compiled to a single MIME source, sent once, and the exact same
 * bytes are appended to the Sent folder over IMAP so the copy matches what the
 * recipient receives.
 */
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type { ComposeAttachmentInput, ComposePayload, MailAddress, ServerConfig } from '@shared/types'
import { createLogger } from '../../util/logger'

const log = createLogger('smtp')

export type SmtpAuth =
  | { kind: 'password'; user: string; pass: string }
  | { kind: 'oauth2'; user: string; accessToken: string }

export interface SmtpSendResult {
  ok: boolean
  messageId: string
  raw: Buffer
  accepted: string[]
  rejected: string[]
  response: string
}

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'network' | 'server' | 'recipient'
  ) {
    super(message)
    this.name = 'SmtpError'
  }
}

export function describeAddress(address: MailAddress): string {
  if (!address.address) return ''
  if (!address.name) return address.address
  const escaped = address.name.replace(/"/g, '\\"')
  return `"${escaped}" <${address.address}>`
}

export function formatAddressList(list: MailAddress[]): string {
  return list
    .filter((a) => a.address && a.address.includes('@'))
    .map(describeAddress)
    .join(', ')
}

export function createTransport(server: ServerConfig, auth: SmtpAuth, options: { pool?: boolean } = {}): Transporter {
  const authConfig =
    auth.kind === 'password'
      ? { user: auth.user, pass: auth.pass }
      : { type: 'OAuth2' as const, user: auth.user, accessToken: auth.accessToken }

  return nodemailer.createTransport({
    host: server.host,
    port: server.port,
    secure: server.secure,
    auth: authConfig,
    requireTLS: !server.secure,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    pool: options.pool ?? false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000
  })
}

export interface BuildMessageOptions {
  payload: ComposePayload
  from: MailAddress
  /** prefix used to make the Message-ID unique per account */
  messageIdDomain: string
}

export function buildMailOptions(options: BuildMessageOptions): Record<string, unknown> {
  const { payload, from, messageIdDomain } = options
  const messageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}@${messageIdDomain}>`

  const headers: Record<string, string> = {}
  if (payload.importance === 'high') {
    headers['X-Priority'] = '1'
    headers['Importance'] = 'High'
  } else if (payload.importance === 'low') {
    headers['X-Priority'] = '5'
    headers['Importance'] = 'Low'
  }
  if (payload.requestReadReceipt) headers['Disposition-Notification-To'] = from.address
  if (payload.mode === 'redirect' && payload.redirectTo) {
    headers['Resent-From'] = from.address
    headers['Resent-To'] = payload.redirectTo.address
  }

  const attachments = payload.attachments.map((attachment: ComposeAttachmentInput) => ({
    filename: attachment.name,
    path: attachment.path,
    contentType: attachment.mimeType || undefined,
    cid: attachment.isInline ? attachment.contentId ?? attachment.name : undefined,
    contentDisposition: attachment.isInline ? ('inline' as const) : ('attachment' as const)
  }))

  return {
    from: describeAddress(from),
    to: formatAddressList(payload.to),
    cc: payload.cc.length > 0 ? formatAddressList(payload.cc) : undefined,
    bcc: payload.bcc.length > 0 ? formatAddressList(payload.bcc) : undefined,
    subject: payload.subject,
    text: payload.text || undefined,
    html: payload.html || undefined,
    inReplyTo: payload.inReplyTo ?? undefined,
    references: payload.references.length > 0 ? payload.references : undefined,
    messageId,
    headers,
    attachments,
    date: new Date()
  }
}

export async function compileMessage(options: BuildMessageOptions): Promise<Buffer> {
  const mail = new MailComposer(buildMailOptions(options))
  return mail.compile().build()
}

export function classifySmtpError(error: unknown): SmtpError {
  const err = error as { code?: string; responseCode?: number; message?: string; response?: string }
  const message = err?.message ?? String(error)
  if (err?.code === 'EAUTH' || err?.responseCode === 535 || /auth|credentials/i.test(message)) {
    return new SmtpError(
      'The outgoing mail server rejected the sign-in. Check the username and password (or app password). ' +
        'Gmail and Microsoft 365 need OAuth or an app password.',
      'auth'
    )
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|socket|TLS|certificate/i.test(message) ||
    err?.code === 'ETIMEDOUT'
  ) {
    return new SmtpError(
      'Novamail could not reach the outgoing mail server. The message is saved in the Outbox and will be retried.',
      'network'
    )
  }
  if (err?.responseCode && err.responseCode >= 500 && err.responseCode < 600) {
    return new SmtpError(
      `The mail server rejected the message: ${err.response ?? message}. It stays in the Outbox so nothing is lost.`,
      'recipient'
    )
  }
  return new SmtpError(`Sending failed: ${message}`, 'server')
}

export async function sendRaw(
  transporter: Transporter,
  options: {
    raw: Buffer
    from: string
    to: string[]
  }
): Promise<SmtpSendResult> {
  const info = (await transporter.sendMail({
    envelope: { from: options.from, to: options.to },
    raw: options.raw
  })) as {
    messageId?: string
    accepted?: string[]
    rejected?: string[]
    response?: string
  }

  log.info('message handed to the outgoing server', {
    accepted: info.accepted?.length ?? 0,
    rejected: info.rejected?.length ?? 0
  })

  return {
    ok: true,
    messageId: info.messageId ?? '',
    raw: options.raw,
    accepted: (info.accepted ?? []) as string[],
    rejected: (info.rejected ?? []) as string[],
    response: info.response ?? ''
  }
}

export async function verifySmtp(server: ServerConfig, auth: SmtpAuth): Promise<{ ok: boolean; message: string }> {
  const transporter = createTransport(server, auth)
  try {
    await transporter.verify()
    return { ok: true, message: 'The outgoing server accepted the sign-in.' }
  } catch (error) {
    const classified = classifySmtpError(error)
    return { ok: false, message: classified.message }
  } finally {
    transporter.close()
  }
}
