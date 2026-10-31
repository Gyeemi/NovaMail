/**
 * Account management tests: the paths a user takes from Settings > Accounts
 * when an account needs to be signed in again.
 *
 * The repositories are in-memory stand-ins so these run without a database; the
 * behaviours asserted here are the ones the UI depends on (which account gets
 * the new tokens, what the user is told, and what the account badge shows).
 */
import { describe, expect, it, vi } from 'vitest'
import type { Account, ProviderCapabilities } from '@shared/types'
import type { OAuthTokens } from '../../src/main/services/credentials'
import { AccountService } from '../../src/main/services/accounts/service'
import { OAuthCancelledError, OAuthNotConfiguredError } from '../../src/main/services/oauth/service'

const capabilities: ProviderCapabilities = {
  oauth: true,
  imap: true,
  smtp: true,
  calendar: 'google',
  contacts: 'google',
  serverSearch: true,
  idle: true,
  labels: true,
  snooze: true,
  readReceipts: true,
  deliveryReceipts: true,
  redirect: false
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    email: 'ada@example.com',
    displayName: 'Ada',
    providerId: 'gmail',
    authType: 'oauth2',
    oauthProvider: 'google',
    username: 'ada@example.com',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    color: '#2f6fed',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSyncAt: null,
    syncState: 'idle',
    lastError: null,
    capabilities,
    signatureId: null,
    ...overrides
  }
}

const tokens: OAuthTokens = {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  expiresAt: Date.now() + 3_600_000,
  tokenType: 'Bearer'
}

interface Harness {
  service: AccountService
  accounts: Map<string, Account>
  secrets: Map<string, { tokens?: OAuthTokens; password?: string }>
  signIn: ReturnType<typeof vi.fn>
  oauth: {
    isConfigured: ReturnType<typeof vi.fn>
    signIn: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
    saveClient: ReturnType<typeof vi.fn>
    cancelSignIn: ReturnType<typeof vi.fn>
  }
}

function harness(options: {
  accounts?: Account[]
  configured?: boolean
  signInImpl?: () => Promise<unknown>
} = {}): Harness {
  const accounts = new Map((options.accounts ?? [makeAccount()]).map((account) => [account.id, account]))
  const secrets = new Map<string, { tokens?: OAuthTokens; password?: string }>()
  const configured = options.configured ?? true
  const signIn = vi.fn(options.signInImpl ?? (async () => ({
    provider: 'google',
    tokens,
    profile: { email: 'ada@example.com', displayName: 'Ada' }
  })))
  const oauth = {
    isConfigured: vi.fn(() => configured),
    signIn,
    status: vi.fn(() => [
      { provider: 'google' as const, configured, clientId: configured ? '1234567890-...' : null, tenant: null },
      { provider: 'microsoft' as const, configured: false, clientId: null, tenant: 'common' }
    ]),
    saveClient: vi.fn(),
    cancelSignIn: vi.fn(() => true)
  }

  const repo = {
    list: () => [...accounts.values()],
    get: (id: string) => accounts.get(id) ?? null,
    findByEmail: (email: string) =>
      [...accounts.values()].find((account) => account.email.toLowerCase() === email.toLowerCase()) ?? null,
    count: () => accounts.size,
    defaultAccount: () => [...accounts.values()][0] ?? null,
    create: (record: Partial<Account>) => {
      const account = makeAccount({ id: `acc-${accounts.size + 1}`, ...record })
      accounts.set(account.id, account)
      return account
    },
    update: () => undefined,
    setOAuthProvider: (id: string, provider: Account['oauthProvider']) => {
      const account = accounts.get(id)
      if (account) accounts.set(id, { ...account, oauthProvider: provider })
    },
    setSyncState: (id: string, state: Account['syncState'], error: string | null = null) => {
      const account = accounts.get(id)
      if (account) accounts.set(id, { ...account, syncState: state, lastError: error })
    },
    remove: () => undefined,
    setDefault: () => undefined
  }

  const credentials = {
    get: (id: string) => secrets.get(id) ?? null,
    set: (id: string, secret: { tokens?: OAuthTokens; password?: string }) => {
      secrets.set(id, secret)
    },
    patch: (id: string, patch: { tokens?: OAuthTokens; password?: string }) => {
      secrets.set(id, { ...(secrets.get(id) ?? {}), ...patch })
    },
    remove: (id: string) => {
      secrets.delete(id)
    }
  }

  const service = new AccountService({
    accounts: repo,
    folders: { list: () => [], createLocal: () => ({}) },
    credentials,
    oauth,
    sessions: { testConnection: vi.fn() },
    settings: { get: () => ({ defaultAccountId: null, ui: {} }), update: vi.fn() }
  } as unknown as ConstructorParameters<typeof AccountService>[0])

  return { service, accounts, secrets, signIn, oauth }
}

describe('Sign in again (reconnect)', () => {
  it('refreshes the tokens of the account being managed', async () => {
    const test = harness()
    const result = await test.service.reconnect('acc-1')

    expect(result.ok).toBe(true)
    expect(result.accountId).toBe('acc-1')
    expect(test.secrets.get('acc-1')?.tokens?.accessToken).toBe('new-access')
    expect(test.accounts.get('acc-1')?.syncState).toBe('idle')
    expect(test.accounts.get('acc-1')?.lastError).toBeNull()
    // Signing in again must not create a duplicate account for the same mailbox.
    expect(test.accounts.size).toBe(1)
    // The provider page is asked to preselect the address being managed.
    expect(test.signIn).toHaveBeenCalledWith('google', 'ada@example.com')
  })

  it('tells the user to use the app password when the account is not OAuth', async () => {
    const test = harness({
      accounts: [makeAccount({ authType: 'password', oauthProvider: null, providerId: 'generic' })]
    })
    const result = await test.service.reconnect('acc-1')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Change password/i)
    expect(test.signIn).not.toHaveBeenCalled()
  })

  it('refuses to relabel an account when a different mailbox was chosen', async () => {
    const test = harness({
      signInImpl: async () => ({
        provider: 'google',
        tokens,
        profile: { email: 'someone.else@example.com', displayName: 'Someone' }
      })
    })
    const result = await test.service.reconnect('acc-1')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('someone.else@example.com')
    expect(result.error).toContain('ada@example.com')
    expect(test.accounts.get('acc-1')?.email).toBe('ada@example.com')
    expect(test.secrets.get('acc-1')).toBeUndefined()
  })

  it('points at the other account when the chosen mailbox already exists', async () => {
    const other = makeAccount({ id: 'acc-2', email: 'other@example.com' })
    const test = harness({
      accounts: [makeAccount(), other],
      signInImpl: async () => ({
        provider: 'google',
        tokens,
        profile: { email: 'other@example.com', displayName: 'Other' }
      })
    })
    const result = await test.service.reconnect('acc-1')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/already a separate account/i)
    expect(test.secrets.get('acc-2')).toBeUndefined()
  })

  it('reports a cancellation without touching the account', async () => {
    const test = harness({
      signInImpl: async () => {
        throw new OAuthCancelledError()
      }
    })
    const result = await test.service.reconnect('acc-1')

    expect(result).toMatchObject({ ok: false, cancelled: true })
    expect(test.accounts.get('acc-1')?.syncState).toBe('idle')
    expect(test.secrets.get('acc-1')).toBeUndefined()
  })

  it('marks the account as needing sign-in after a failed re-authorisation', async () => {
    const test = harness({
      signInImpl: async () => {
        throw new Error('The authorisation expired or was revoked. Please sign in again. (invalid_grant)')
      }
    })
    const result = await test.service.reconnect('acc-1')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid_grant/)
    expect(test.accounts.get('acc-1')?.syncState).toBe('auth-required')
    expect(test.accounts.get('acc-1')?.lastError).toMatch(/sign in again/i)
  })

  it('explains what to configure when no client id is saved', async () => {
    const test = harness({ configured: false })
    const result = await test.service.startOAuth('google')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Settings > Accounts > Sign-in providers/)
    expect(test.signIn).not.toHaveBeenCalled()
  })

  it('never reports success when the provider object is missing', async () => {
    const test = harness()
    const result = await test.service.reconnect('missing')
    expect(result).toEqual({ ok: false, error: 'That account no longer exists.' })
  })
})

describe('Adding an account through OAuth', () => {
  it('creates the account once and stores the tokens in the secret store', async () => {
    const test = harness({
      accounts: [],
      signInImpl: async () => ({
        provider: 'google',
        tokens,
        profile: { email: 'new@example.com', displayName: 'New Person' }
      })
    })
    const result = await test.service.startOAuth('google')

    expect(result.ok).toBe(true)
    expect(result.account?.email).toBe('new@example.com')
    expect(test.secrets.get(result.account!.id)?.tokens?.refreshToken).toBe('new-refresh')
    expect(test.accounts.size).toBe(1)
  })

  it('reuses an existing account instead of duplicating it on a second sign-in', async () => {
    const test = harness()
    const result = await test.service.startOAuth('google')

    expect(result.ok).toBe(true)
    expect(test.accounts.size).toBe(1)
    expect(test.secrets.get('acc-1')?.tokens?.accessToken).toBe('new-access')
  })
})

describe('Revoking access', () => {
  it('clears the tokens and shows the account as needing a new sign-in', async () => {
    const test = harness()
    test.secrets.set('acc-1', { tokens })

    await test.service.revokeOAuth('acc-1')

    expect(test.secrets.get('acc-1')?.tokens).toBeUndefined()
     expect(test.accounts.get('acc-1')?.syncState).toBe('auth-required')
    expect(test.accounts.get('acc-1')?.lastError).toMatch(/Sign in again/i)
  })
})

describe('Provider configuration', () => {
  it('saves a client id and returns the refreshed status list', () => {
    const test = harness({ configured: false })
    const status = test.service.saveOAuthClient('google', 'client-abcdefgh.apps.googleusercontent.com')

    expect(test.oauth.saveClient).toHaveBeenCalledWith('google', {
      clientId: 'client-abcdefgh.apps.googleusercontent.com',
      tenant: undefined
    })
    expect(status).toHaveLength(2)
    expect(status.some((entry) => entry.provider === 'microsoft')).toBe(true)
  })

  it('cancels a sign-in that is waiting for the browser', () => {
    const test = harness()
    expect(test.service.cancelOAuth()).toBe(true)
    expect(test.oauth.cancelSignIn).toHaveBeenCalled()
  })
})

describe('Not-configured errors', () => {
  it('carries a readable message and a provider name', () => {
    const error = new OAuthNotConfiguredError('microsoft')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/Microsoft/)
    expect(error.message).toMatch(/not configured/i)
    // Not a cancellation: the account must stay as it is rather than be marked stale.
    expect(Boolean((error as { cancelled?: boolean }).cancelled)).toBe(false)
  })
})
