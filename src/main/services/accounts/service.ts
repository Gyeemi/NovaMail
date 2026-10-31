/**
 * Novamail - account service.
 *
 * Owns the lifecycle of accounts: discovery, connection test, creation with
 * credentials, OAuth sign-in, editing, default account selection and removal.
 * Passwords/tokens only ever travel from the wizard into the encrypted credential
 * store; they are never written to logs, the database or the renderer afterwards.
 */
import type {
  Account,
  AccountDraftInput,
  ConnectionTestResult,
  ProviderCapabilities,
  ProviderId
} from '@shared/types'
import type { AutoconfigResult, OAuthProviderStatus, OAuthStartResult } from '@shared/ipc'
import type { AccountsRepository, CreateAccountRecord } from '../db/repositories/accounts'
import type { FoldersRepository } from '../db/repositories/folders'
import type { CredentialStore } from '../credentials'
import type { OAuthService } from '../oauth/service'
import type { SessionManager } from '../mail/sessions'
import type { SettingsService } from '../settings'
import { discoverAutoconfig } from './autoconfig'
import { PROVIDERS, ACCOUNT_COLORS } from '@shared/providers'
import { verifySmtp } from '../mail/smtp'
import { createLogger } from '../../util/logger'
import { appEvents } from '../../util/events'
import { newId } from '../../util/ids'

const log = createLogger('accounts')

export interface AccountServiceDeps {
  accounts: AccountsRepository
  folders: FoldersRepository
  credentials: CredentialStore
  oauth: OAuthService
  sessions: SessionManager
  settings: SettingsService
  onAccountCreated?: (account: Account) => void
  onAccountRemoved?: (accountId: string) => void
}

export class AccountService {
  constructor(private readonly deps: AccountServiceDeps) {}

  list(): Account[] {
    return this.deps.accounts.list()
  }

  async autoconfigure(email: string): Promise<AutoconfigResult> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a complete email address, for example name@example.com.')
    }
    return discoverAutoconfig(email)
  }

  private capabilitiesFor(providerId: ProviderId): ProviderCapabilities {
    return { ...PROVIDERS[providerId].capabilities }
  }

  private colorFor(email: string): string {
    let hash = 0
    for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) % 997
    return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length]!
  }

  /** Tests IMAP and SMTP with the values the user typed (nothing is saved). */
  async test(input: AccountDraftInput): Promise<ConnectionTestResult> {
    const draftAccount = this.toTestAccount(input)
    let auth: Parameters<SessionManager['testConnection']>[1]

    if (input.authType === 'password') {
      const password = input.password ?? this.deps.credentials.get(input.id ?? '')?.password
      if (!password) {
        return { ok: false, error: 'Enter the password or app password for this account.' }
      }
      auth = { kind: 'password', user: input.username || input.email, pass: password }
    } else {
      const tokens = input.id ? this.deps.credentials.get(input.id)?.tokens : undefined
      if (!tokens) {
        return {
          ok: false,
          error: 'Sign in with the provider first. Novamail never asks for your Google or Microsoft password.'
        }
      }
      auth = { kind: 'oauth2', user: input.username || input.email, accessToken: tokens.accessToken }
    }

    const imap = await this.deps.sessions.testConnection(draftAccount, auth)
    const smtp = await verifySmtp(input.smtp, auth)
    const ok = imap.ok && smtp.ok
    return {
      ok,
      imap: { ok: imap.ok, message: imap.message, folders: imap.folders },
      smtp: { ok: smtp.ok, message: smtp.message },
      error: ok ? undefined : !imap.ok ? imap.message : smtp.message
    }
  }

  private toTestAccount(input: AccountDraftInput): Account {
    return {
      id: input.id ?? 'draft',
      email: input.email,
      displayName: input.displayName || input.email,
      providerId: input.providerId,
      authType: input.authType,
      oauthProvider: input.oauthProvider ?? PROVIDERS[input.providerId].oauthProvider ?? null,
      username: input.username || input.email,
      imap: input.imap,
      smtp: input.smtp,
      color: input.color ?? this.colorFor(input.email),
      isDefault: false,
      createdAt: new Date().toISOString(),
      lastSyncAt: null,
      syncState: 'idle',
      lastError: null,
      capabilities: this.capabilitiesFor(input.providerId),
      signatureId: null
    }
  }

  async create(input: AccountDraftInput): Promise<Account> {
    this.validateDraft(input)
    const existing = this.deps.accounts.findByEmail(input.email)
    if (existing) throw new Error(`${input.email} is already set up in Novamail.`)

    const record: CreateAccountRecord = {
      email: input.email,
      displayName: input.displayName || input.email.split('@')[0]!,
      providerId: input.providerId,
      authType: input.authType,
      oauthProvider: input.oauthProvider ?? PROVIDERS[input.providerId].oauthProvider ?? null,
      username: input.username || input.email,
      imap: input.imap,
      smtp: input.smtp,
      color: input.color ?? this.colorFor(input.email),
      capabilities: this.capabilitiesFor(input.providerId)
    }

    const account = this.deps.accounts.create(record)

    if (input.authType === 'password') {
      if (!input.password) {
        this.deps.accounts.remove(account.id)
        throw new Error('A password (or app password) is required for this provider.')
      }
      this.deps.credentials.set(account.id, { password: input.password })
    }

    this.ensureDefaultAccount(account)
    log.info('account created', { provider: account.providerId, authType: account.authType })
    appEvents.emit('folders:changed', { accountId: account.id })
    this.deps.onAccountCreated?.(account)
    return account
  }

  async update(input: AccountDraftInput): Promise<Account> {
    if (!input.id) throw new Error('Account id is required.')
    const current = this.deps.accounts.get(input.id)
    if (!current) throw new Error('Account not found.')
    this.validateDraft({ ...input, email: input.email || current.email })

    const updated = this.deps.accounts.update(input.id, {
      email: input.email,
      displayName: input.displayName,
      providerId: input.providerId,
      authType: input.authType,
      username: input.username,
      imap: input.imap,
      smtp: input.smtp,
      color: input.color,
      capabilities: this.capabilitiesFor(input.providerId)
    })

    if (input.authType === 'password' && input.password) {
      this.deps.credentials.patch(input.id, { password: input.password })
    }
    await this.deps.sessions.closeSession(input.id)
    log.info('account updated', { accountId: input.id })
    return updated
  }

  private validateDraft(input: AccountDraftInput): void {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email ?? '')) {
      throw new Error('Enter a valid email address.')
    }
    if (!input.imap?.host || !input.imap.port) throw new Error('Enter the incoming (IMAP) server and port.')
    if (!input.smtp?.host || !input.smtp.port) throw new Error('Enter the outgoing (SMTP) server and port.')
    if (!input.authType) throw new Error('Choose how Novamail should sign in.')
  }

  private ensureDefaultAccount(account: Account): void {
    const settings = this.deps.settings.get()
    if (!settings.defaultAccountId) {
      this.deps.settings.update({ defaultAccountId: account.id })
    }
    if (account.isDefault) {
      this.deps.settings.update({ defaultAccountId: account.id })
    }
  }

  setDefault(id: string): void {
    this.deps.accounts.setDefault(id)
    this.deps.settings.update({ defaultAccountId: id })
  }

  async remove(id: string): Promise<void> {
    await this.deps.sessions.closeSession(id)
    this.deps.credentials.remove(id)
    this.deps.accounts.remove(id)
    const settings = this.deps.settings.get()
    if (settings.defaultAccountId === id) {
      const next = this.deps.accounts.defaultAccount()
      this.deps.settings.update({ defaultAccountId: next?.id ?? null })
    }
    this.deps.onAccountRemoved?.(id)
    appEvents.emit('folders:changed', {})
    appEvents.emit('messages:changed', { reason: 'refresh' })
    log.info('account removed', { accountId: id })
  }

  /**
   * Interactive OAuth sign-in. The account is created (or its tokens refreshed)
   * only after the provider returned a valid profile, so a failed attempt leaves
   * no half-configured account behind.
   */
  /** Provider configuration state for the accounts screen. */
  oauthStatus(): OAuthProviderStatus[] {
    return this.deps.oauth.status()
  }

  saveOAuthClient(provider: 'google' | 'microsoft', clientId: string, tenant?: string): OAuthProviderStatus[] {
    this.deps.oauth.saveClient(provider, { clientId, tenant })
    return this.oauthStatus()
  }

  cancelOAuth(): boolean {
    return this.deps.oauth.cancelSignIn()
  }

  /**
   * Re-authorises an existing account. The account is chosen first, so the
   * provider page can be used to pick which mailbox to sign into, but a
   * different address is never silently written over the account the user
   * asked to manage - that would relabel one mailbox as another.
   */
  async reconnect(accountId: string): Promise<OAuthStartResult> {
    const account = this.deps.accounts.get(accountId)
    if (!account) return { ok: false, error: 'That account no longer exists.' }
    if (account.authType !== 'oauth2' || !account.oauthProvider) {
      return {
        ok: false,
        error: `${account.email} uses an app password, not OAuth. Choose Edit on the account in Settings > Accounts to change its password or servers.`
      }
    }
    return this.startOAuth(account.oauthProvider, account.email, accountId)
  }

  async startOAuth(
    provider: 'google' | 'microsoft',
    loginHint?: string,
    targetAccountId?: string
  ): Promise<OAuthStartResult> {
    if (!this.deps.oauth.isConfigured(provider)) {
      return {
        ok: false,
        error:
          provider === 'google'
            ? 'Google sign-in is not configured yet. Add a Google OAuth client ID under Settings > Accounts > Sign-in providers.'
            : 'Microsoft sign-in is not configured yet. Add a Microsoft application (client) ID under Settings > Accounts > Sign-in providers.'
      }
    }
    try {
      const result = await this.deps.oauth.signIn(provider, loginHint)
      const providerId: ProviderId = provider === 'google' ? 'gmail' : 'microsoft365'
      const existing = this.deps.accounts.findByEmail(result.profile.email)

      // Re-authorising a specific account: the provider page may let the user
      // pick any mailbox, so only accept the address the account already is.
      if (targetAccountId) {
        const target = this.deps.accounts.get(targetAccountId)
        if (!target) return { ok: false, error: 'That account no longer exists.' }
        if (target.email.toLowerCase() !== result.profile.email.toLowerCase()) {
          const other = this.deps.accounts.findByEmail(result.profile.email)
          return {
            ok: false,
            error: other
              ? `You signed in as ${result.profile.email}, which is already a separate account in Novamail. Choose Reconnect on that account instead, or sign in as ${target.email}.`
              : `You signed in as ${result.profile.email}, but this account is ${target.email}. Sign in with ${target.email}, or add ${result.profile.email} as a new account.`
          }
        }
        this.deps.credentials.patch(target.id, { tokens: result.tokens })
        this.deps.accounts.setOAuthProvider(target.id, provider)
        this.deps.accounts.setSyncState(target.id, 'idle', null)
        appEvents.emit('oauth:result', { ok: true, accountId: target.id })
        appEvents.emit('accounts:changed', { accountId: target.id })
        log.info('oauth account re-authorised', { provider, accountId: target.id })
        return { ok: true, account: this.deps.accounts.get(target.id) ?? target, accountId: target.id }
      }

      if (existing) {
        this.deps.credentials.patch(existing.id, { tokens: result.tokens })
        this.deps.accounts.setOAuthProvider(existing.id, provider)
        this.deps.accounts.setSyncState(existing.id, 'idle', null)
        appEvents.emit('accounts:changed', {})
        log.info('oauth account re-authorised', { provider, accountId: existing.id })
        return { ok: true, account: existing, accountId: existing.id }
      }

      const providerConfig = PROVIDERS[provider === 'google' ? 'gmail' : providerId]
      const account = this.deps.accounts.create({
        email: result.profile.email,
        displayName: result.profile.displayName || result.profile.email.split('@')[0]!,
        providerId,
        authType: 'oauth2',
        oauthProvider: provider,
        username: result.profile.email,
        imap: providerConfig.imap!,
        smtp: providerConfig.smtp!,
        color: this.colorFor(result.profile.email),
        capabilities: this.capabilitiesFor(providerId)
      })
      this.deps.credentials.set(account.id, { tokens: result.tokens })
      this.ensureDefaultAccount(account)
      log.info('oauth account created', { provider })
      this.deps.onAccountCreated?.(account)
      appEvents.emit('oauth:result', { ok: true })
      appEvents.emit('accounts:changed', {})
      return { ok: true, account }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cancelled = Boolean((error as { cancelled?: boolean })?.cancelled)
      if (cancelled) {
        log.info('oauth sign-in cancelled', { provider })
        return { ok: false, cancelled: true, error: message }
      }
      log.warn('oauth sign-in failed', { provider, message })
      // A failed re-authorisation must leave the account visibly needing a retry
      // rather than looking healthy.
      if (targetAccountId && this.deps.accounts.get(targetAccountId)) {
        this.deps.accounts.setSyncState(targetAccountId, 'auth-required', message)
        appEvents.emit('accounts:changed', {})
      }
      return { ok: false, error: message }
    }
  }

  async revokeOAuth(accountId: string): Promise<void> {
    const secret = this.deps.credentials.get(accountId)
    if (secret?.tokens?.refreshToken && this.deps.oauth.isConfigured('google')) {
      // Best-effort revocation at the provider (Google supports it for refresh tokens).
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: secret.tokens.refreshToken }).toString()
        })
      } catch (error) {
        log.warn('token revocation failed', { error })
      }
    }
    this.deps.credentials.patch(accountId, { tokens: undefined })
    // Without tokens the account cannot sync, so say so instead of leaving it
    // looking connected until the next sync fails.
    this.deps.accounts.setSyncState(accountId, 'auth-required', 'Access was revoked. Choose "Sign in again" to reconnect.')
    appEvents.emit('accounts:changed', {})
  }

  /** Creates the local folder skeleton for an account that has never synced. */
  ensureFolderSkeleton(accountId: string): void {
    const existing = this.deps.folders.list(accountId)
    if (existing.length > 0) return
    for (const [path, kind] of [
      ['INBOX', 'inbox'],
      ['Drafts', 'drafts'],
      ['Sent', 'sent'],
      ['Archive', 'archive'],
      ['Spam', 'spam'],
      ['Trash', 'trash']
    ] as const) {
      const folder = this.deps.folders.createLocal(accountId, path)
      if (folder.kind !== kind) {
        // classifyFolder may map "Archive"/"Sent" correctly; nothing else to do
      }
    }
    void newId
  }
}
