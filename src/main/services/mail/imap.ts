/**
 * Novamail - IMAP transport (imapflow).
 *
 * Only the main process ever holds a connection. TLS certificates are always
 * validated; STARTTLS upgrades are allowed only when the server supports them.
 */
import { ImapFlow } from 'imapflow'
import type { FolderKind, ServerConfig } from '@shared/types'
import { classifyFolder } from '../db/repositories/folders'
import { createLogger } from '../../util/logger'

const log = createLogger('imap')

/** Normalises the assorted date shapes imapflow can return into an ISO string. */
function toIsoDate(value: Date | string | undefined | null): string {
  if (!value) return new Date().toISOString()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export type ImapAuth =
  | { kind: 'password'; user: string; pass: string }
  | { kind: 'oauth2'; user: string; accessToken: string }

export interface ImapConnectionOptions {
  server: ServerConfig
  auth: ImapAuth
  clientName?: string
}

export interface RemoteFolder {
  path: string
  name: string
  delimiter: string
  parentPath: string | null
  kind: FolderKind
  uidValidity: number | null
}

export interface RemoteEnvelope {
  uid: number
  messageId: string | null
  subject: string
  from: { name: string; address: string }
  to: { name: string; address: string }[]
  cc: { name: string; address: string }[]
  replyTo: { name: string; address: string }[]
  date: string
  size: number
  flags: string[]
  headers: Record<string, string>
  hasAttachments: boolean
  attachmentCount: number
  structure: { filename: string; mimeType: string; size: number; contentId: string | null; disposition: 'attachment' | 'inline' }[]
}

export interface DownloadedMessage {
  envelope: RemoteEnvelope
  source: Buffer
}

const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_HEADER_BYTES = 32 * 1024

export class ImapAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImapAuthError'
  }
}

export class ImapTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImapTransportError'
  }
}

export function createClient(options: ImapConnectionOptions): ImapFlow {
  const auth =
    options.auth.kind === 'password'
      ? { user: options.auth.user, pass: options.auth.pass }
      : { user: options.auth.user, accessToken: options.auth.accessToken }

  const client = new ImapFlow({
    host: options.server.host,
    port: options.server.port,
    secure: options.server.secure,
    auth,
    logger: false,
    // Never disable certificate validation. This is deliberate.
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    clientInfo: { name: options.clientName ?? 'Novamail', version: '1.0.0' },
    emitLogs: false,
    disableAutoIdle: false,
    // keep the socket alive through NAT timeouts
    maxIdleTime: 8 * 60 * 1000
  })
  // Prevent an unhandled 'error' event from crashing the app.
  client.on('error', (error: unknown) => {
    log.warn('imap client error', { error })
  })
  return client
}

export function classifyImapError(error: unknown): { kind: 'auth' | 'network' | 'server'; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: string; responseText?: string; authenticationFailed?: boolean })?.code ?? ''
  const authenticationFailed = Boolean((error as { authenticationFailed?: boolean })?.authenticationFailed)

  if (
    authenticationFailed ||
    /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|AUTHENTICATE failed|authentication/i.test(message) ||
    code === 'EAUTH'
  ) {
    return { kind: 'auth', message: friendlyAuthMessage(message) }
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket|ECONNRESET|TLS|certificate|self.signed/i.test(
      message
    )
  ) {
    return { kind: 'network', message: friendlyNetworkMessage(message) }
  }
  return { kind: 'server', message }
}

function friendlyAuthMessage(raw: string): string {
  if (/app.?password/i.test(raw)) return raw
  return (
    'The mail server rejected the sign-in. Check the username and password (or app password) and try again. ' +
    'Gmail and Microsoft 365 require OAuth sign-in or an app password.'
  )
}

function friendlyNetworkMessage(raw: string): string {
  if (/certificate|self.signed/i.test(raw)) {
    return (
      'The server certificate could not be verified, so Novamail stopped the connection to protect your data. ' +
      'Contact your mail provider or IT administrator.'
    )
  }
  return 'Novamail could not reach the mail server. Check your internet connection and the server settings.'
}

export function mapFolders(
  list: { path: string; name?: string; delimiter?: string; specialUse?: string; status?: { uidValidity?: number } }[]
): RemoteFolder[] {
  return list
    .filter((item) => !/\\Noselect/i.test(String((item as { flags?: Set<string> }).flags ?? '')))
    .map((item) => {
      const path = item.path
      const delimiter = item.delimiter || '/'
      const parts = path.split(delimiter)
      const name = item.name || parts[parts.length - 1] || path
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join(delimiter) : null
      let kind: FolderKind = 'folder'
      const special = String(item.specialUse ?? '').toLowerCase()
      if (special.includes('\\inbox')) kind = 'inbox'
      else if (special.includes('\\drafts')) kind = 'drafts'
      else if (special.includes('\\sent')) kind = 'sent'
      else if (special.includes('\\archive')) kind = 'archive'
      else if (special.includes('\\junk')) kind = 'spam'
      else if (special.includes('\\trash')) kind = 'trash'
      else if (special.includes('\\all')) kind = 'archive'
      else kind = classifyFolder(path)
      if (/^inbox$/i.test(path)) kind = 'inbox'
      return {
        path,
        name,
        delimiter,
        parentPath,
        kind,
        uidValidity: item.status?.uidValidity ?? null
      }
    })
}

function headerValue(headers: Buffer | undefined, name: string): string | null {
  if (!headers) return null
  const text = headers.toString('utf8')
  const regex = new RegExp(`^${name}:\\s*(.+)$`, 'im')
  const match = regex.exec(text)
  return match ? match[1]!.trim() : null
}

function parseAddressList(value: string | null | undefined): { name: string; address: string }[] {
  if (!value) return []
  return value
    .split(',')
    .map((chunk) => {
      const trimmed = chunk.trim()
      const angle = /^(.*?)<([^>]+)>$/.exec(trimmed)
      if (angle) return { name: angle[1]!.replace(/^"|"$/g, '').trim(), address: angle[2]!.trim() }
      if (trimmed.includes('@')) return { name: '', address: trimmed }
      return null
    })
    .filter((v): v is { name: string; address: string } => v !== null)
}

/** Flattens an IMAP body structure into a plain attachment list. */
export function flattenStructure(
  node: ImapFlowBodyStructure | undefined,
  acc: { filename: string; mimeType: string; size: number; contentId: string | null; disposition: 'attachment' | 'inline' }[] = []
): typeof acc {
  if (!node) return acc
  const disposition = node.disposition ? String(node.disposition).toLowerCase() : ''
  const isAttachment =
    Boolean(node.disposition) || Boolean(node.parameters?.['name']) || (node.type === 'application' && !node.childNodes)
  if (node.childNodes?.length) {
    for (const child of node.childNodes) flattenStructure(child, acc)
    return acc
  }
  if (!isAttachment) return acc
  const filename =
    node.dispositionParameters?.['filename'] ??
    node.parameters?.['name'] ??
    `${node.type ?? 'file'}${node.subtype ? `.${String(node.subtype).toLowerCase()}` : ''}`
  acc.push({
    filename: String(filename),
    mimeType: `${node.type ?? 'application'}/${node.subtype ?? 'octet-stream'}`.toLowerCase(),
    size: node.size ?? 0,
    contentId: node.dispositionParameters?.['cid'] ?? node.parameters?.['cid'] ?? null,
    disposition: disposition.includes('inline') ? 'inline' : 'attachment'
  })
  return acc
}

// Minimal structural type for imapflow bodyStructure nodes
export interface ImapFlowBodyStructure {
  type?: string
  subtype?: string
  size?: number
  disposition?: string
  dispositionParameters?: Record<string, string>
  parameters?: Record<string, string>
  childNodes?: ImapFlowBodyStructure[]
}

export interface ListOptions {
  /** when set, only messages with a higher UID are requested */
  sinceUid?: number
  limit?: number
}

export class ImapSession {
  private client: ImapFlow
  private connected = false

  constructor(private readonly options: ImapConnectionOptions) {
    this.client = createClient(options)
  }

  get raw(): ImapFlow {
    return this.client
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect()
      this.connected = true
    } catch (error) {
      const info = classifyImapError(error)
      if (info.kind === 'auth') throw new ImapAuthError(info.message)
      throw new ImapTransportError(info.message)
    }
  }

  async logout(): Promise<void> {
    if (!this.connected) return
    try {
      await this.client.logout()
    } catch {
      /* ignore */
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected && this.client.usable
  }

  async listFolders(): Promise<RemoteFolder[]> {
    const list = await this.client.list()
    return mapFolders(list as never)
  }

  async withMailbox<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const lock = await this.client.getMailboxLock(path)
    try {
      return await fn()
    } finally {
      lock.release()
    }
  }

  mailboxUidValidity(): number | null {
    const validity = this.client.mailbox && typeof this.client.mailbox === 'object' ? this.client.mailbox.uidValidity : null
    return validity === null || validity === undefined ? null : Number(validity)
  }

  mailboxExists(): boolean {
    return Boolean(this.client.mailbox)
  }

  /** Reads envelopes for messages newer than sinceUid. */
  async fetchHeaders(path: string, options: ListOptions = {}): Promise<RemoteEnvelope[]> {
    return this.withMailbox(path, async () => {
      const sinceUid = options.sinceUid ?? 0
      const limit = options.limit ?? 200
      const range = sinceUid > 0 ? `${sinceUid + 1}:*` : '1:*'
      const results: RemoteEnvelope[] = []

      for await (const message of this.client.fetch(
        range,
        {
          uid: true,
          envelope: true,
          flags: true,
          size: true,
          bodyStructure: true,
          internalDate: true,
          headers: ['references', 'in-reply-to', 'list-unsubscribe', 'message-id', 'x-priority', 'importance']
        },
        { uid: true }
      )) {
        if (message.uid <= sinceUid) continue
        const envelope = message.envelope ?? ({} as NonNullable<typeof message.envelope>)
        const headers: Record<string, string> = {}
        const rawHeaders = (message as { headers?: Buffer }).headers
        for (const name of ['references', 'in-reply-to', 'list-unsubscribe', 'message-id', 'x-priority', 'importance']) {
          const value = headerValue(rawHeaders, name)
          if (value) headers[name] = value
        }
        const structure = (message as { bodyStructure?: ImapFlowBodyStructure }).bodyStructure
        const attachments = flattenStructure(structure)
        const from = envelope.from?.[0]
        results.push({
          uid: message.uid,
          messageId: envelope.messageId ?? headers['message-id'] ?? null,
          subject: envelope.subject ?? '',
          from: {
            name: from?.name ?? '',
            address: from?.address ?? ''
          },
          to: (envelope.to ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' })),
          cc: (envelope.cc ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' })),
          replyTo: (envelope.replyTo ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' })),
          date: toIsoDate(message.internalDate ?? envelope.date),
          size: message.size ?? 0,
          flags: [...(message.flags ?? new Set<string>())],
          headers,
          hasAttachments: attachments.length > 0,
          attachmentCount: attachments.length,
          structure: attachments
        })
        if (results.length >= limit) break
      }
      return results
    })
  }

  async downloadMessage(path: string, uid: number): Promise<{ source: Buffer; flags: string[] }> {
    return this.withMailbox(path, async () => {
      const message = await this.client.fetchOne(uid, { source: true, flags: true }, { uid: true })
      if (!message || !message.source) throw new ImapTransportError('The server did not return this message.')
      if (message.source.length > MAX_BODY_BYTES) {
        throw new ImapTransportError(
          'This message is larger than 8 MB and was not downloaded in full. Open it on the server or raise the limit.'
        )
      }
      return { source: message.source, flags: [...(message.flags ?? new Set<string>())] }
    })
  }

  async fetchHeaderOnly(path: string, uid: number): Promise<Buffer | null> {
    return this.withMailbox(path, async () => {
      const message = await this.client.fetchOne(uid, { headers: true }, { uid: true })
      const headers = message === false ? undefined : message.headers
      if (!headers) return null
      return headers.subarray(0, MAX_HEADER_BYTES)
    })
  }

  async setFlags(path: string, uids: number[], flags: string[], add: boolean): Promise<void> {
    if (uids.length === 0) return
    await this.withMailbox(path, async () => {
      if (add) await this.client.messageFlagsAdd(uids.join(','), flags, { uid: true })
      else await this.client.messageFlagsRemove(uids.join(','), flags, { uid: true })
    })
  }

  async moveMessages(path: string, uids: number[], target: string): Promise<void> {
    if (uids.length === 0) return
    await this.withMailbox(path, async () => {
      await this.client.messageMove(uids.join(','), target, { uid: true })
    })
  }

  async deleteMessages(path: string, uids: number[]): Promise<void> {
    if (uids.length === 0) return
    await this.withMailbox(path, async () => {
      await this.client.messageDelete(uids.join(','), { uid: true })
    })
  }

  async appendMessage(path: string, source: Buffer, flags: string[] = ['\\Seen']): Promise<void> {
    await this.client.append(path, source, flags)
  }

  async search(path: string, criteria: { from?: string; subject?: string; text?: string; since?: Date }): Promise<number[]> {
    return this.withMailbox(path, async () => {
      const searchObject: Record<string, unknown> = {}
      if (criteria.from) searchObject.from = criteria.from
      if (criteria.subject) searchObject.subject = criteria.subject
      if (criteria.text) searchObject.text = criteria.text
      if (criteria.since) searchObject.since = criteria.since
      if (Object.keys(searchObject).length === 0) return []
      const result = await this.client.search(searchObject, { uid: true })
      return Array.isArray(result) ? result.slice(0, 500) : []
    })
  }

  async listFolderCounts(path: string): Promise<{ messages: number; unseen: number } | null> {
    try {
      const status = await this.client.status(path, { messages: true, unseen: true })
      if (!status) return null
      return { messages: status.messages ?? 0, unseen: status.unseen ?? 0 }
    } catch {
      return null
    }
  }

  async createFolder(path: string): Promise<void> {
    await this.client.mailboxCreate(path)
  }

  async renameFolder(path: string, newPath: string): Promise<void> {
    await this.client.mailboxRename(path, newPath)
  }

  async deleteFolder(path: string): Promise<void> {
    await this.client.mailboxDelete(path)
  }

  /** Optional IDLE support: resolves on the first EXISTS notification. */
  async waitForNewMail(timeoutMs: number): Promise<boolean> {
    return this.withMailbox('INBOX', async () => {
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.client.removeListener('exists', onExists)
          resolve(false)
        }, timeoutMs)
        const onExists = (): void => {
          clearTimeout(timer)
          this.client.removeListener('exists', onExists)
          resolve(true)
        }
        this.client.on('exists', onExists)
        void this.client.noop().catch(() => undefined)
      })
    })
  }
}

export { parseAddressList }
