/**
 * Novamail - IMAP session manager.
 *
 * One connection per account, operations serialised per account (IMAP is a
 * stateful protocol), automatic reconnection and transparent OAuth token refresh.
 * Access tokens never leave this module.
 */
import type { Account, Id } from '@shared/types'
import type { AccountsRepository } from '../db/repositories/accounts'
import type { CredentialStore, OAuthTokens } from '../credentials'
import type { OAuthService } from '../oauth/service'
import { ImapAuthError, ImapSession, ImapTransportError, classifyImapError } from './imap'
import type { ImapAuth } from './imap'
import { createLogger } from '../../util/logger'

const log = createLogger('sessions')

const TOKEN_REFRESH_MARGIN_MS = 90_000

export class MissingCredentialsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingCredentialsError'
  }
}

export interface SessionManagerDeps {
  accounts: AccountsRepository
  credentials: CredentialStore
  oauth: OAuthService
}

export class SessionManager {
  private readonly sessions = new Map<Id, ImapSession>()
  private readonly chains = new Map<Id, Promise<unknown>>()

  constructor(private readonly deps: SessionManagerDeps) {}

  /** Serialises work per account so two features never fight over a mailbox. */
  private runExclusive<T>(accountId: Id, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(accountId) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.chains.set(
      accountId,
      next.catch(() => undefined)
    )
    return next
  }

  async resolveAuth(account: Account): Promise<ImapAuth> {
    const secret = this.deps.credentials.get(account.id)
    if (account.authType === 'password') {
      if (!secret?.password) {
        throw new MissingCredentialsError(
          `Novamail has no saved password for ${account.email}. Open Settings > Accounts and enter it again.`
        )
      }
      return { kind: 'password', user: account.username, pass: secret.password }
    }

    if (!account.oauthProvider) {
      throw new MissingCredentialsError(`${account.email} was set up with OAuth but the provider is missing.`)
    }
    if (!secret?.tokens) {
      throw new MissingCredentialsError(
        `${account.email} needs to sign in again. Open Settings > Accounts and choose "Sign in again".`
      )
    }
    let tokens: OAuthTokens = secret.tokens
    const expired = tokens.expiresAt !== null && tokens.expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS
    if (expired && tokens.refreshToken) {
      try {
        tokens = await this.deps.oauth.refresh(account.oauthProvider, tokens.refreshToken)
        this.deps.credentials.patch(account.id, { tokens })
        log.info('oauth access token refreshed', { accountId: account.id })
      } catch (error) {
        log.error('oauth refresh failed', { accountId: account.id, error })
        throw new MissingCredentialsError(
          `The sign-in for ${account.email} expired. Open Settings > Accounts and sign in again.`
        )
      }
    }
    return { kind: 'oauth2', user: account.username, accessToken: tokens.accessToken }
  }

  private async createSession(account: Account): Promise<ImapSession> {
    const auth = await this.resolveAuth(account)
    const session = new ImapSession({ server: account.imap, auth })
    await session.connect()
    log.info('imap session connected', { accountId: account.id, host: account.imap.host })
    return session
  }

  /** Runs a callback with a live session, reconnecting once if needed. */
  async withSession<T>(accountId: Id, task: (session: ImapSession, account: Account) => Promise<T>): Promise<T> {
    return this.runExclusive(accountId, async () => {
      const account = this.deps.accounts.get(accountId)
      if (!account) throw new Error('Account not found')

      let session = this.sessions.get(accountId)
      if (session && !session.isConnected()) {
        session = undefined
        this.sessions.delete(accountId)
      }

      if (!session) {
        session = await this.createSession(account)
        this.sessions.set(accountId, session)
      }

      try {
        return await task(session, account)
      } catch (error) {
        const info = classifyImapError(error)
        if (info.kind === 'network') {
          // one reconnect attempt for transient socket failures
          await this.closeSession(accountId)
          const retry = await this.createSession(account)
          this.sessions.set(accountId, retry)
          try {
            return await task(retry, account)
          } catch (retryError) {
            await this.closeSession(accountId)
            const retryInfo = classifyImapError(retryError)
            this.deps.accounts.setSyncState(
              accountId,
              retryInfo.kind === 'auth' ? 'auth-required' : 'error',
              retryInfo.message
            )
            throw retryError instanceof ImapSession ? retryError : new ImapTransportError(retryInfo.message)
          }
        }
        if (info.kind === 'auth') {
          this.deps.accounts.setSyncState(accountId, 'auth-required', info.message)
          await this.closeSession(accountId)
          throw new ImapAuthError(info.message)
        }
        throw error
      }
    })
  }

  /** Returns a session without acquiring the lock (read-only helpers). */
  peek(accountId: Id): ImapSession | undefined {
    return this.sessions.get(accountId)
  }

  async closeSession(accountId: Id): Promise<void> {
    const session = this.sessions.get(accountId)
    this.sessions.delete(accountId)
    if (session) await session.logout()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id)))
  }

  isConnected(accountId: Id): boolean {
    return this.sessions.get(accountId)?.isConnected() ?? false
  }

  /** Tests a candidate configuration without touching stored state. */
  async testConnection(account: Account, auth: ImapAuth): Promise<{ ok: boolean; message: string; folders: number }> {
    const session = new ImapSession({ server: account.imap, auth })
    try {
      await session.connect()
      const folders = await session.listFolders()
      return {
        ok: true,
        message: `Connected to ${account.imap.host} and found ${folders.length} folders.`,
        folders: folders.length
      }
    } catch (error) {
      const info = classifyImapError(error)
      return { ok: false, message: info.message, folders: 0 }
    } finally {
      await session.logout()
    }
  }
}
