/**
 * Novamail - OAuth 2.0 authorisation-code flow with PKCE and a loopback redirect.
 *
 * Why this design:
 *  - No client secret is shipped in the app; PKCE protects the code exchange.
 *  - The redirect goes to a short-lived 127.0.0.1 listener that only accepts the
 *    single expected state value, then shuts down immediately.
 *  - Users authenticate on Google's / Microsoft's own page in their real browser.
 *    Novamail never renders a password form and never sees the password, and it
 *    never attempts to bypass MFA or conditional access.
 *
 * Client IDs are configuration, not code: set them in
 *   %APPDATA%\Novamail\oauth.json   or   NOVAMAIL_GOOGLE_CLIENT_ID etc.
 * A client ID alone is not enough - the redirect URI must be registered on the
 * provider application, see docs/ACCOUNT-SETUP.md.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { OAuthTokens } from '../credentials'
import { createLogger } from '../../util/logger'
import { createPkce, createState, decodeIdToken } from './pkce'

const log = createLogger('oauth')

/** Thrown when the user cancels from the app, so callers can stay quiet about it. */
export class OAuthCancelledError extends Error {
  readonly cancelled = true
  constructor(message = 'Sign-in was cancelled.') {
    super(message)
    this.name = 'OAuthCancelledError'
  }
}

/** Thrown when a provider is not configured yet (no client id registered). */
export class OAuthNotConfiguredError extends Error {
  constructor(public readonly provider: OAuthProviderId) {
    super(
      provider === 'google'
        ? 'Google sign-in is not configured yet. Add a Google OAuth client ID in Settings > Accounts.'
        : 'Microsoft sign-in is not configured yet. Add a Microsoft application (client) ID in Settings > Accounts.'
    )
    this.name = 'OAuthNotConfiguredError'
  }
}

export type OAuthProviderId = 'google' | 'microsoft'

export interface OAuthClientConfig {
  clientId: string
  clientSecret?: string
  tenant?: string
  redirectPort?: number
}

export interface OAuthFileConfig {
  google?: OAuthClientConfig
  microsoft?: OAuthClientConfig
}

export interface OAuthProfile {
  email: string
  displayName: string
}

export interface OAuthResult {
  tokens: OAuthTokens
  profile: OAuthProfile
  provider: OAuthProviderId
}

export interface OAuthServiceOptions {
  configFile: string
  openExternal: (url: string) => Promise<unknown>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const AUTH_ENDPOINTS = {
  google: 'https://accounts.google.com/o/oauth2/v2/auth',
  microsoft: (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`
} as const

const TOKEN_ENDPOINTS = {
  google: 'https://oauth2.googleapis.com/token',
  microsoft: (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
} as const

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://mail.google.com/'
].join(' ')

export const MICROSOFT_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send'
].join(' ')

export function buildAuthUrl(options: {
  provider: OAuthProviderId
  client: OAuthClientConfig
  redirectUri: string
  state: string
  challenge: string
  loginHint?: string
}): string {
  const { provider, client, redirectUri, state, challenge, loginHint } = options
  const tenant = client.tenant ?? 'common'
  const base = provider === 'google' ? AUTH_ENDPOINTS.google : AUTH_ENDPOINTS.microsoft(tenant)
  const url = new URL(base)
  url.searchParams.set('client_id', client.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', provider === 'google' ? GOOGLE_SCOPES : MICROSOFT_SCOPES)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'select_account')
  if (provider === 'google') url.searchParams.set('include_granted_scopes', 'true')
  if (loginHint) {
    if (provider === 'google') url.searchParams.set('login_hint', loginHint)
    else url.searchParams.set('login_hint', loginHint)
  }
  return url.toString()
}

export function redirectUriFor(provider: OAuthProviderId, port: number): string {
  // Google requires an explicit /oauth/callback path for loopback desktop clients.
  // Microsoft treats http://localhost as a native redirect and ignores the port.
  return provider === 'google' ? `http://127.0.0.1:${port}/oauth/callback` : `http://localhost:${port}`
}

export class OAuthService {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  /** Set while a flow is waiting for the browser redirect. */
  private pendingReject: ((error: Error) => void) | null = null

  constructor(private readonly options: OAuthServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000
  }

  readConfig(): OAuthFileConfig {
    const fromEnv: OAuthFileConfig = {}
    if (process.env.NOVAMAIL_GOOGLE_CLIENT_ID) {
      fromEnv.google = {
        clientId: process.env.NOVAMAIL_GOOGLE_CLIENT_ID,
        clientSecret: process.env.NOVAMAIL_GOOGLE_CLIENT_SECRET
      }
    }
    if (process.env.NOVAMAIL_MICROSOFT_CLIENT_ID) {
      fromEnv.microsoft = {
        clientId: process.env.NOVAMAIL_MICROSOFT_CLIENT_ID,
        clientSecret: process.env.NOVAMAIL_MICROSOFT_CLIENT_SECRET,
        tenant: process.env.NOVAMAIL_MICROSOFT_TENANT ?? 'common'
      }
    }
    let fromFile: OAuthFileConfig = {}
    try {
      if (fs.existsSync(this.options.configFile)) {
        fromFile = JSON.parse(fs.readFileSync(this.options.configFile, 'utf8')) as OAuthFileConfig
      }
    } catch (error) {
      log.error('oauth.json could not be read', { error })
    }
    return {
      google: fromEnv.google ?? fromFile.google,
      microsoft: fromEnv.microsoft ?? fromFile.microsoft
    }
  }

  isConfigured(provider: OAuthProviderId): boolean {
    return Boolean(this.readConfig()[provider]?.clientId)
  }

  private clientFor(provider: OAuthProviderId): OAuthClientConfig {
    const config = this.readConfig()[provider]
    if (!config?.clientId) throw new OAuthNotConfiguredError(provider)
    return config
  }

  /**
   * Saves a client registration so the sign-in flow can run without editing
   * files by hand. Only the public client id and tenant are stored here; a
   * client secret (only needed for confidential clients) stays in the
   * environment so it is never written into the user's profile directory.
   */
  saveClient(provider: OAuthProviderId, input: { clientId: string; tenant?: string }): OAuthClientConfig {
    const clientId = input.clientId.trim()
    if (!/^[A-Za-z0-9._-]{8,200}$/.test(clientId)) {
      throw new Error('That client ID does not look right. Paste the application (client) ID from the provider portal.')
    }
    const existing = this.readConfigFile()
    const next: OAuthFileConfig = { ...existing }
    const previous = next[provider]
    next[provider] = {
      ...previous,
      clientId,
      ...(provider === 'microsoft' ? { tenant: (input.tenant ?? previous?.tenant ?? 'common').trim() || 'common' } : {})
    }
    this.writeConfigFile(next)
    log.info('oauth client saved', { provider })
    return next[provider]!
  }

  private readConfigFile(): OAuthFileConfig {
    try {
      if (!fs.existsSync(this.options.configFile)) return {}
      const parsed = JSON.parse(fs.readFileSync(this.options.configFile, 'utf8')) as OAuthFileConfig
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      log.error('oauth.json could not be read', { error })
      return {}
    }
  }

  private writeConfigFile(config: OAuthFileConfig): void {
    fs.mkdirSync(path.dirname(this.options.configFile), { recursive: true })
    // 0600: the file holds a public client id, but it is still per-user config.
    fs.writeFileSync(this.options.configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  }

  /**
   * Never returns a full client id to the renderer. Enough of the value is shown
   * to tell two registrations apart (a Google id by its project number, a
   * Microsoft id by its last characters) without moving the whole value around.
   */
  private static maskClientId(clientId: string): string {
    const googleStyle = /^(\d{6,})-[A-Za-z0-9_-]+/.exec(clientId)
    if (googleStyle) return `${googleStyle[1]}-...`
    return `...${clientId.slice(-6)}`
  }

  /** Describes what the UI needs to know about each provider. */
  status(): { provider: OAuthProviderId; configured: boolean; clientId: string | null; tenant: string | null }[] {
    const config = this.readConfig()
    return (['google', 'microsoft'] as OAuthProviderId[]).map((provider) => ({
      provider,
      configured: Boolean(config[provider]?.clientId),
      clientId: config[provider]?.clientId ? OAuthService.maskClientId(config[provider]!.clientId) : null,
      tenant: config[provider]?.tenant ?? (provider === 'microsoft' ? 'common' : null)
    }))
  }

  /** True while a flow is waiting for the browser callback. */
  isSigningIn(): boolean {
    return this.pendingReject !== null
  }

  /** Cancels the flow that is currently waiting for the browser. */
  cancelSignIn(): boolean {
    const reject = this.pendingReject
    if (!reject) return false
    this.pendingReject = null
    reject(new OAuthCancelledError())
    return true
  }

  /** Runs the full interactive flow and returns fresh tokens plus the account profile. */
  async signIn(provider: OAuthProviderId, loginHint?: string): Promise<OAuthResult> {
    const client = this.clientFor(provider)
    const pkce = createPkce()
    const state = createState()

    const { server, port } = await this.startLoopbackServer()
    const redirectUri = redirectUriFor(provider, port)
    const authUrl = buildAuthUrl({
      provider,
      client,
      redirectUri,
      state,
      challenge: pkce.challenge,
      loginHint
    })

    log.info('starting oauth flow', { provider, redirectUri, port })

    const codePromise = this.waitForCode(server, state)
    // Recover the rejection so cancelling or timing out cannot surface as an
    // unhandled rejection in the main process.
    codePromise.catch(() => undefined)

    await this.options.openExternal(authUrl)

    let code: string
    try {
      code = await codePromise
    } finally {
      this.pendingReject = null
      this.stopServer(server)
    }

    const tokens = await this.exchangeCode({ provider, client, code, redirectUri, verifier: pkce.verifier })
    const profile = await this.resolveProfile(provider, tokens)
    return { tokens, profile, provider }
  }

  async exchangeCode(options: {
    provider: OAuthProviderId
    client: OAuthClientConfig
    code: string
    redirectUri: string
    verifier: string
  }): Promise<OAuthTokens> {
    const { provider, client, code, redirectUri, verifier } = options
    const tenant = client.tenant ?? 'common'
    const endpoint = provider === 'google' ? TOKEN_ENDPOINTS.google : TOKEN_ENDPOINTS.microsoft(tenant)
    const body = new URLSearchParams({
      client_id: client.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
    if (client.clientSecret) body.set('client_secret', client.clientSecret)
    if (provider === 'microsoft') body.set('scope', MICROSOFT_SCOPES)

    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    return this.parseTokenResponse(response, provider)
  }

  async refresh(provider: OAuthProviderId, refreshToken: string): Promise<OAuthTokens> {
    const client = this.clientFor(provider)
    const tenant = client.tenant ?? 'common'
    const endpoint = provider === 'google' ? TOKEN_ENDPOINTS.google : TOKEN_ENDPOINTS.microsoft(tenant)
    const body = new URLSearchParams({
      client_id: client.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
    if (client.clientSecret) body.set('client_secret', client.clientSecret)
    if (provider === 'microsoft') body.set('scope', MICROSOFT_SCOPES)

    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    const tokens = await this.parseTokenResponse(response, provider)
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
  }

  private async parseTokenResponse(response: Response, provider: OAuthProviderId): Promise<OAuthTokens> {
    const text = await response.text()
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      /* fall through */
    }
    // Providers normally use a 4xx for a rejected grant, but treat an error body
    // as a failure regardless so a 200 with `error` cannot look like success.
    if (!response.ok || (json.error && !json.access_token)) {
      const errorCode = String(json.error ?? response.status)
      const description = String(json.error_description ?? json.error ?? text.slice(0, 200))
      log.error('token endpoint rejected the request', { provider, status: response.status, errorCode })
      if (errorCode === 'invalid_grant') {
        throw new Error(
          'The authorisation expired or was revoked. Please sign in again. (invalid_grant)'
        )
      }
      throw new Error(`${provider === 'google' ? 'Google' : 'Microsoft'} sign-in failed: ${description}`)
    }
    const accessToken = String(json.access_token ?? '')
    if (!accessToken) throw new Error('The provider did not return an access token.')
    const expiresIn = Number(json.expires_in ?? 0)
    return {
      accessToken,
      refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
      expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
      scope: json.scope ? String(json.scope) : undefined,
      tokenType: json.token_type ? String(json.token_type) : 'Bearer'
    }
  }

  private async resolveProfile(provider: OAuthProviderId, tokens: OAuthTokens): Promise<OAuthProfile> {
    const claims = tokens.accessToken.includes('.') ? decodeIdToken(tokens.accessToken) : null
    const idTokenEmail = claims?.['email'] ?? claims?.['preferred_username'] ?? claims?.['upn']
    if (typeof idTokenEmail === 'string' && idTokenEmail.includes('@')) {
      return { email: idTokenEmail, displayName: String(claims?.['name'] ?? idTokenEmail.split('@')[0]) }
    }
    try {
      if (provider === 'google') {
        const response = await this.fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { authorization: `Bearer ${tokens.accessToken}` }
        })
        if (response.ok) {
          const json = (await response.json()) as { email?: string; name?: string }
          if (json.email) return { email: json.email, displayName: json.name ?? json.email.split('@')[0]! }
        }
      } else {
        const response = await this.fetchImpl('https://graph.microsoft.com/v1.0/me', {
          headers: { authorization: `Bearer ${tokens.accessToken}` }
        })
        if (response.ok) {
          const json = (await response.json()) as {
            mail?: string
            userPrincipalName?: string
            displayName?: string
          }
          const email = json.mail ?? json.userPrincipalName
          if (email) return { email, displayName: json.displayName ?? email.split('@')[0]! }
        }
      }
    } catch (error) {
      log.error('could not read the account profile', { provider, error })
    }
    throw new Error('Signed in, but the email address could not be read from the provider. Please try again.')
  }

  private async startLoopbackServer(): Promise<{ server: http.Server; port: number }> {
    const server = http.createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as AddressInfo).port
    return { server, port }
  }

  private stopServer(server: http.Server): void {
    try {
      server.close()
    } catch {
      /* ignore */
    }
  }

  private waitForCode(server: http.Server, expectedState: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Sign-in timed out after 5 minutes. Please try again.'))
      }, this.timeoutMs)

      const handler = (request: http.IncomingMessage, response: http.ServerResponse): void => {
        const url = new URL(request.url ?? '/', `http://localhost`)
        const returnedState = url.searchParams.get('state')
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        const respond = (status: number, title: string, message: string): void => {
          response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
          response.end(
            `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
              `<style>body{font-family:Segoe UI,system-ui,sans-serif;background:#eef2f5;color:#26313a;` +
              `display:flex;align-items:center;justify-content:center;height:100vh;margin:0}` +
              `main{background:#f7fafc;border-radius:18px;padding:40px 48px;box-shadow:0 18px 40px rgba(38,49,58,.14);max-width:520px}` +
              `h1{font-size:22px;margin:0 0 12px}p{font-size:16px;line-height:1.6;margin:0;color:#4a5866}</style>` +
              `</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`
          )
        }

        if (error) {
          respond(400, 'Sign-in cancelled', 'You can close this tab and return to Novamail.')
          cleanup()
          reject(new Error(`Sign-in was cancelled (${error}).`))
          return
        }
        if (!code) {
          respond(400, 'Waiting for sign-in', 'Novamail has not received the authorisation code yet.')
          return
        }
        if (returnedState !== expectedState) {
          respond(400, 'Sign-in rejected', 'The security check failed. Please start again from Novamail.')
          cleanup()
          reject(new Error('The sign-in response failed the state check (possible CSRF). Please try again.'))
          return
        }
        respond(200, 'Novamail is connected', 'You can close this tab and return to Novamail.')
        cleanup()
        resolve(code)
      }

      const cleanup = (): void => {
        clearTimeout(timer)
        server.off('request', handler)
        server.off('error', onError)
        if (this.pendingReject === onCancel) this.pendingReject = null
      }
      // Lets the app cancel a flow the user abandoned in the browser.
      const onCancel = (error: Error): void => {
        cleanup()
        reject(error)
      }
      this.pendingReject = onCancel
      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }

      server.on('request', handler)
      server.on('error', onError)
    })
  }
}
