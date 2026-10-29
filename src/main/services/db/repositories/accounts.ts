/**
 * Novamail - account repository. Credentials are NEVER stored here.
 */
import type { Account, AccountSyncState, ProviderCapabilities, ProviderId } from '@shared/types'
import type { Db } from '../database'
import { newId, nowIso } from '../../../util/ids'

interface AccountRow {
  id: string
  email: string
  display_name: string
  provider_id: string
  auth_type: string
  oauth_provider: string | null
  username: string
  imap_host: string
  imap_port: number
  imap_secure: number
  smtp_host: string
  smtp_port: number
  smtp_secure: number
  color: string
  is_default: number
  created_at: string
  last_sync_at: string | null
  sync_state: string
  last_error: string | null
  capabilities: string
  signature_id: string | null
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  oauth: false,
  imap: true,
  smtp: true,
  calendar: 'none',
  contacts: 'none',
  serverSearch: true,
  idle: true,
  labels: false,
  snooze: true,
  readReceipts: false,
  deliveryReceipts: false,
  redirect: false
}

export function mapAccount(row: AccountRow): Account {
  let capabilities: ProviderCapabilities = DEFAULT_CAPABILITIES
  try {
    capabilities = { ...DEFAULT_CAPABILITIES, ...JSON.parse(row.capabilities) }
  } catch {
    /* keep defaults */
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    providerId: row.provider_id as ProviderId,
    authType: row.auth_type as Account['authType'],
    oauthProvider: (row.oauth_provider as Account['oauthProvider']) ?? null,
    username: row.username,
    imap: { host: row.imap_host, port: row.imap_port, secure: row.imap_secure === 1 },
    smtp: { host: row.smtp_host, port: row.smtp_port, secure: row.smtp_secure === 1 },
    color: row.color,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    lastSyncAt: row.last_sync_at,
    syncState: row.sync_state as AccountSyncState,
    lastError: row.last_error,
    capabilities,
    signatureId: row.signature_id
  }
}

export interface CreateAccountRecord {
  email: string
  displayName: string
  providerId: ProviderId
  authType: Account['authType']
  oauthProvider: Account['oauthProvider']
  username: string
  imap: Account['imap']
  smtp: Account['smtp']
  color: string
  capabilities: ProviderCapabilities
}

export class AccountsRepository {
  constructor(private readonly db: Db) {}

  list(): Account[] {
    const rows = this.db
      .prepare('SELECT * FROM accounts ORDER BY is_default DESC, email ASC')
      .all() as AccountRow[]
    return rows.map(mapAccount)
  }

  get(id: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined
    return row ? mapAccount(row) : null
  }

  findByEmail(email: string): Account | null {
    const row = this.db
      .prepare('SELECT * FROM accounts WHERE lower(email) = lower(?)')
      .get(email) as AccountRow | undefined
    return row ? mapAccount(row) : null
  }

  defaultAccount(): Account | null {
    const row = this.db
      .prepare('SELECT * FROM accounts ORDER BY is_default DESC, created_at ASC LIMIT 1')
      .get() as AccountRow | undefined
    return row ? mapAccount(row) : null
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }).c
  }

  create(record: CreateAccountRecord): Account {
    const id = newId()
    const isFirst = this.count() === 0
    this.db
      .prepare(
        `INSERT INTO accounts (id, email, display_name, provider_id, auth_type, oauth_provider, username,
          imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, color, is_default,
          created_at, sync_state, capabilities)
         VALUES (@id, @email, @displayName, @providerId, @authType, @oauthProvider, @username,
          @imapHost, @imapPort, @imapSecure, @smtpHost, @smtpPort, @smtpSecure, @color, @isDefault,
          @createdAt, 'idle', @capabilities)`
      )
      .run({
        id,
        email: record.email,
        displayName: record.displayName,
        providerId: record.providerId,
        authType: record.authType,
        oauthProvider: record.oauthProvider,
        username: record.username,
        imapHost: record.imap.host,
        imapPort: record.imap.port,
        imapSecure: record.imap.secure ? 1 : 0,
        smtpHost: record.smtp.host,
        smtpPort: record.smtp.port,
        smtpSecure: record.smtp.secure ? 1 : 0,
        color: record.color,
        isDefault: isFirst ? 1 : 0,
        createdAt: nowIso(),
        capabilities: JSON.stringify(record.capabilities)
      })
    return this.get(id)!
  }

  update(id: string, patch: Partial<CreateAccountRecord>): Account {
    const current = this.get(id)
    if (!current) throw new Error('Account not found')
    this.db
      .prepare(
        `UPDATE accounts SET email=@email, display_name=@displayName, provider_id=@providerId,
          auth_type=@authType, username=@username, imap_host=@imapHost, imap_port=@imapPort,
          imap_secure=@imapSecure, smtp_host=@smtpHost, smtp_port=@smtpPort, smtp_secure=@smtpSecure,
          color=@color, capabilities=@capabilities
         WHERE id=@id`
      )
      .run({
        id,
        email: patch.email ?? current.email,
        displayName: patch.displayName ?? current.displayName,
        providerId: patch.providerId ?? current.providerId,
        authType: patch.authType ?? current.authType,
        username: patch.username ?? current.username,
        imapHost: patch.imap?.host ?? current.imap.host,
        imapPort: patch.imap?.port ?? current.imap.port,
        imapSecure: (patch.imap?.secure ?? current.imap.secure) ? 1 : 0,
        smtpHost: patch.smtp?.host ?? current.smtp.host,
        smtpPort: patch.smtp?.port ?? current.smtp.port,
        smtpSecure: (patch.smtp?.secure ?? current.smtp.secure) ? 1 : 0,
        color: patch.color ?? current.color,
        capabilities: JSON.stringify(patch.capabilities ?? current.capabilities)
      })
    return this.get(id)!
  }

  setOAuthProvider(id: string, provider: Account['oauthProvider']): void {
    this.db.prepare('UPDATE accounts SET oauth_provider = ? WHERE id = ?').run(provider, id)
  }

  setDefault(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE accounts SET is_default = 0').run()
      this.db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').run(id)
    })
    tx()
  }

  setSyncState(id: string, state: AccountSyncState, error: string | null = null): void {
    this.db.prepare('UPDATE accounts SET sync_state = ?, last_error = ? WHERE id = ?').run(state, error, id)
  }

  touchSync(id: string): void {
    this.db
      .prepare("UPDATE accounts SET last_sync_at = ?, sync_state = 'idle', last_error = NULL WHERE id = ?")
      .run(nowIso(), id)
  }

  setSignature(id: string, signatureId: string | null): void {
    this.db.prepare('UPDATE accounts SET signature_id = ? WHERE id = ?').run(signatureId, id)
  }

  setLastUid(id: string, uid: number): void {
    this.db.prepare('UPDATE accounts SET imap_last_uid = ? WHERE id = ?').run(uid, id)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
    const remaining = this.count()
    if (remaining > 0) {
      const hasDefault = this.db.prepare('SELECT 1 FROM accounts WHERE is_default = 1').get()
      if (!hasDefault) {
        const first = this.db.prepare('SELECT id FROM accounts ORDER BY created_at LIMIT 1').get() as
          | { id: string }
          | undefined
        if (first) this.setDefault(first.id)
      }
    }
  }
}
