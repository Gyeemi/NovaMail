/**
 * OAuth sign-in flow tests.
 *
 * These exercise the *real* loopback listener and PKCE exchange with a stubbed
 * provider: the browser is simulated by fetching the redirect URI that the auth
 * URL advertises, exactly like the system browser would after the user signs in.
 * No network access is required.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { OAuthCancelledError, OAuthService, redirectUriFor } from '../../src/main/services/oauth/service'

function tempConfig(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'novamail-oauth-'))
  return path.join(dir, 'oauth.json')
}

interface HarnessOptions {
  /** Behaviour of the simulated browser. Default: approve immediately. */
  browser?: (authUrl: URL) => Promise<void> | void
  tokenPayload?: Record<string, unknown>
}

function harness(options: HarnessOptions = {}): {
  service: OAuthService
  configFile: string
  opened: URL[]
} {
  const configFile = tempConfig()
  const opened: URL[] = []
  const service = new OAuthService({
    configFile,
    timeoutMs: 4_000,
    openExternal: async (url) => {
      const parsed = new URL(url)
      opened.push(parsed)
      if (options.browser) await options.browser(parsed)
    },
    fetchImpl: (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/token')) {
        return new Response(
          JSON.stringify(
            options.tokenPayload ?? {
              access_token: 'access-token-123',
              refresh_token: 'refresh-token-123',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'openid email'
            }
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.includes('userinfo') || url.includes('graph.microsoft.com')) {
        return new Response(JSON.stringify({ email: 'ada@example.com', mail: 'ada@example.com', userPrincipalName: 'ada@example.com', name: 'Ada Lovelace', displayName: 'Ada Lovelace' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
  })
  return { service, configFile, opened }
}

/** Simulates the provider redirecting the browser back to Novamail. */
async function approve(authUrl: URL, code = 'auth-code-abc'): Promise<void> {
  const redirect = new URL(authUrl.searchParams.get('redirect_uri')!)
  redirect.searchParams.set('code', code)
  redirect.searchParams.set('state', authUrl.searchParams.get('state')!)
  const response = await fetch(redirect, { redirect: 'manual' })
  expect(response.status).toBe(200)
  await response.text()
}

describe('OAuth configuration', () => {
  it('reports both providers as unconfigured and refuses to sign in', async () => {
    const { service } = harness()
    expect(service.isConfigured('google')).toBe(false)
    expect(service.status().every((entry) => !entry.configured)).toBe(true)

    await expect(service.signIn('google')).rejects.toThrow(/not configured/i)
  })

  it('persists a saved client id with 0600 permissions and does not leak it whole', () => {
    const { service, configFile } = harness()
    service.saveClient('google', { clientId: '1234567890-abcdefghijklmnop.apps.googleusercontent.com' })

    expect(service.isConfigured('google')).toBe(true)
    const status = service.status().find((entry) => entry.provider === 'google')!
    expect(status.configured).toBe(true)
    // Only a suffix is exposed so the renderer never holds the registration.
    expect(status.clientId).toBe('1234567890-...')
    expect(status.clientId).not.toContain('abcdefghijklmnop')

    const raw = readFileSync(configFile, 'utf8')
    expect(raw).toContain('apps.googleusercontent.com')
    if (process.platform !== 'win32') {
      expect(statSync(configFile).mode & 0o777).toBe(0o600)
    }
  })

  it('keeps an existing microsoft tenant and defaults to common', () => {
    const { service } = harness()
    service.saveClient('microsoft', { clientId: '00000000-1111-2222-3333-444444444444', tenant: 'contoso.onmicrosoft.com' })
    expect(service.readConfig().microsoft?.tenant).toBe('contoso.onmicrosoft.com')

    service.saveClient('microsoft', { clientId: '99999999-1111-2222-3333-444444444444' })
    expect(service.readConfig().microsoft?.tenant).toBe('contoso.onmicrosoft.com')

    service.saveClient('microsoft', { clientId: '99999999-1111-2222-3333-444444444444', tenant: '   ' })
    expect(service.readConfig().microsoft?.tenant).toBe('common')
  })

  it('rejects a client id that cannot be one', () => {
    const { service } = harness()
    expect(() => service.saveClient('google', { clientId: 'short' })).toThrow(/does not look right/i)
    expect(() => service.saveClient('google', { clientId: 'has spaces in it' })).toThrow(/does not look right/i)
    expect(service.isConfigured('google')).toBe(false)
  })
})

describe('Google sign-in in the system browser', () => {
  it('builds an official Google URL with PKCE and a loopback redirect', async () => {
    const { service, opened } = harness({ browser: (url) => approve(url) })
    service.saveClient('google', { clientId: 'client-abcdefgh.apps.googleusercontent.com' })

    const result = await service.signIn('google', 'ada@example.com')

    expect(opened).toHaveLength(1)
    const authUrl = opened[0]!
    expect(authUrl.origin).toBe('https://accounts.google.com')
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authUrl.searchParams.get('code_verifier')).toBeNull()
    expect(authUrl.searchParams.get('login_hint')).toBe('ada@example.com')
    expect(authUrl.searchParams.get('access_type')).toBe('offline')
    expect(authUrl.searchParams.get('scope')).toContain('https://mail.google.com/')

    const redirectUri = authUrl.searchParams.get('redirect_uri')!
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/)
    // The listener must not outlive the flow.
    await expect(fetch(redirectUri)).rejects.toThrow()

    expect(result.profile.email).toBe('ada@example.com')
    expect(result.tokens.accessToken).toBe('access-token-123')
    expect(result.tokens.refreshToken).toBe('refresh-token-123')
    expect(result.tokens.expiresAt).toBeGreaterThan(Date.now())
  })

  it('builds a Microsoft URL for the configured tenant and localhost redirect', async () => {
    const { service, opened } = harness({ browser: (url) => approve(url) })
    service.saveClient('microsoft', { clientId: '00000000-1111-2222-3333-444444444444', tenant: 'contoso.com' })

    await service.signIn('microsoft')

    const authUrl = opened[0]!
    expect(authUrl.href.startsWith('https://login.microsoftonline.com/contoso.com/oauth2/v2.0/authorize')).toBe(true)
    expect(authUrl.searchParams.get('scope')).toContain('IMAP.AccessAsUser.All')
    expect(authUrl.searchParams.get('redirect_uri')).toBe(redirectUriFor('microsoft', Number(new URL(authUrl.searchParams.get('redirect_uri')!).port)))
  })

  it('rejects a callback whose state does not match', async () => {
    const { service } = harness({
      browser: async (url) => {
        const redirect = new URL(url.searchParams.get('redirect_uri')!)
        redirect.searchParams.set('code', 'evil-code')
        redirect.searchParams.set('state', 'not-the-state')
        const response = await fetch(redirect)
        expect(response.status).toBe(400)
        await response.text()
      }
    })
    service.saveClient('google', { clientId: 'client-abcdefgh.apps.googleusercontent.com' })

    await expect(service.signIn('google')).rejects.toThrow(/state check/i)
  })

  it('surfaces a provider-side denial as a cancellation', async () => {
    const { service } = harness({
      browser: async (url) => {
        const redirect = new URL(url.searchParams.get('redirect_uri')!)
        redirect.searchParams.set('error', 'access_denied')
        redirect.searchParams.set('state', url.searchParams.get('state')!)
        await (await fetch(redirect)).text()
      }
    })
    service.saveClient('google', { clientId: 'client-abcdefgh.apps.googleusercontent.com' })

    const error = await service.signIn('google').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/cancelled/i)
  })

  it('is cancelled from the app while the browser is still open', async () => {
    let signIn!: Promise<unknown>
    const { service } = harness({
      browser: () => {
        // Emulates the user walking away: nothing ever hits the redirect URI.
        setTimeout(() => service.cancelSignIn(), 20)
      }
    })
    service.saveClient('google', { clientId: 'client-abcdefgh.apps.googleusercontent.com' })

    signIn = service.signIn('google')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(service.isSigningIn()).toBe(true)

    const error = await signIn.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(OAuthCancelledError)
    expect((error as OAuthCancelledError).cancelled).toBe(true)
    expect(service.isSigningIn()).toBe(false)
    expect(service.cancelSignIn()).toBe(false)
  })

  it('reports a refused token exchange without hanging', async () => {
    const { service } = harness({
      browser: (url) => approve(url),
      tokenPayload: { error: 'invalid_grant', error_description: 'Bad Request' }
    })
    service.saveClient('google', { clientId: 'client-abcdefgh.apps.googleusercontent.com' })

    await expect(service.signIn('google')).rejects.toThrow(/expired or was revoked/i)
  })
})
