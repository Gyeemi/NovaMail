/**
 * Novamail - secure credential store.
 *
 * On Windows the secrets are encrypted with Electron's safeStorage, which is
 * backed by DPAPI and bound to the Windows user account. Nothing is ever written
 * in plaintext, credentials never leave the main process, and they are never
 * logged or included in crash reports.
 *
 * If the OS key store is unavailable (for example a Linux session without a
 * keyring during development), Novamail falls back to AES-256-GCM with a
 * randomly generated key stored in a 0600 file, and reports the reduced
 * protection in Settings -> About so the user is told the truth.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { Id } from '@shared/types'
import { createLogger } from '../util/logger'

const log = createLogger('credentials')

export interface SecretBackend {
  readonly kind: 'os-encrypted' | 'insecure-fallback'
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number | null
  scope?: string
  tokenType?: string
}

export interface AccountSecret {
  /** IMAP/SMTP password or app password (only for authType=password) */
  password?: string
  tokens?: OAuthTokens
  /** OAuth client registration used for this account (never the client secret of a shared app) */
  clientId?: string
}

interface StoreFile {
  version: 1
  entries: Record<string, { data: string; updatedAt: string }>
}

/** AES-256-GCM fallback used when the OS key store is unavailable. */
export class FallbackBackend implements SecretBackend {
  readonly kind = 'insecure-fallback' as const
  private readonly key: Buffer

  constructor(private readonly keyFile: string) {
    this.key = this.loadOrCreateKey()
  }

  private loadOrCreateKey(): Buffer {
    try {
      if (fs.existsSync(this.keyFile)) {
        const existing = fs.readFileSync(this.keyFile)
        if (existing.length === 32) return existing
      }
      const key = randomBytes(32)
      fs.mkdirSync(path.dirname(this.keyFile), { recursive: true })
      fs.writeFileSync(this.keyFile, key, { mode: 0o600 })
      return key
    } catch (error) {
      log.error('could not persist fallback key, using ephemeral key', { error })
      return randomBytes(32)
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return `fb1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload.slice(4), 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const data = raw.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  }
}

export class CredentialStore {
  private cache: StoreFile | null = null

  constructor(
    private readonly file: string,
    private readonly backend: SecretBackend
  ) {}

  get protection(): 'os-encrypted' | 'insecure-fallback' {
    return this.backend.kind
  }

  private load(): StoreFile {
    if (this.cache) return this.cache
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoreFile
        this.cache = { version: 1, entries: parsed.entries ?? {} }
      } else {
        this.cache = { version: 1, entries: {} }
      }
    } catch (error) {
      log.error('credential store unreadable, starting empty', { error })
      this.cache = { version: 1, entries: {} }
    }
    return this.cache
  }

  private persist(store: StoreFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
    this.cache = store
  }

  get(accountId: Id): AccountSecret | null {
    const entry = this.load().entries[accountId]
    if (!entry) return null
    try {
      return JSON.parse(this.backend.decrypt(entry.data)) as AccountSecret
    } catch (error) {
      log.error('could not decrypt credentials for account', { accountId, error })
      return null
    }
  }

  set(accountId: Id, secret: AccountSecret): void {
    const store = this.load()
    store.entries[accountId] = {
      data: this.backend.encrypt(JSON.stringify(secret)),
      updatedAt: new Date().toISOString()
    }
    this.persist(store)
    log.info('credentials stored', { accountId, hasPassword: Boolean(secret.password), hasTokens: Boolean(secret.tokens) })
  }

  patch(accountId: Id, patch: Partial<AccountSecret>): AccountSecret {
    const current = this.get(accountId) ?? {}
    const next: AccountSecret = { ...current, ...patch }
    if (patch.tokens === undefined && current.tokens) next.tokens = current.tokens
    this.set(accountId, next)
    return next
  }

  remove(accountId: Id): void {
    const store = this.load()
    if (store.entries[accountId]) {
      delete store.entries[accountId]
      this.persist(store)
      log.info('credentials removed', { accountId })
    }
  }

  has(accountId: Id): boolean {
    return Boolean(this.load().entries[accountId])
  }

  accountIds(): Id[] {
    return Object.keys(this.load().entries)
  }
}
