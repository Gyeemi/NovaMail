// @vitest-environment jsdom
/**
 * Settings > Accounts UI tests.
 *
 * Regression cover for "Manage accounts does not work": the screen must offer a
 * way to sign an OAuth account in again, must explain a provider that has not
 * been configured yet, and must let the client ID be saved from the app instead
 * of hand-editing a JSON file.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from '@renderer/App'
import { AppProvider } from '@renderer/state/AppProvider'
import { installMockBridge } from '@renderer/mockBridge'
import type { Account } from '@shared/types'
import type { OAuthProviderStatus } from '@shared/ipc'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const oauthAccount: Account = {
  id: 'oauth-1',
  email: 'anna@gmail.example',
  displayName: 'Anna Dorji',
  providerId: 'gmail',
  authType: 'oauth2',
  oauthProvider: 'google',
  username: 'anna@gmail.example',
  imap: { host: 'imap.gmail.com', port: 993, secure: true },
  smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
  color: '#3f7d8c',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSyncAt: '2026-10-30T00:00:00.000Z',
  syncState: 'auth-required',
  lastError: 'Access was revoked. Choose "Sign in again" to reconnect.',
  capabilities: {
    oauth: true,
    imap: true,
    smtp: true,
    calendar: 'google',
    contacts: 'none',
    serverSearch: true,
    idle: true,
    labels: true,
    snooze: true,
    threads: true,
    move: true,
    serverDrafts: true
  } as Account['capabilities'],
  signatureId: null
}

let container: HTMLDivElement
let root: Root | null = null
let statuses: OAuthProviderStatus[]

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock
  window.HTMLElement.prototype.scrollIntoView = () => undefined
  if (!window.novamail) installMockBridge()
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function openAccounts(): Promise<void> {
  const api = window.novamail!.api
  vi.spyOn(api.accounts, 'list').mockImplementation(async () => [oauthAccount])
  statuses = [
    { provider: 'google', configured: false, clientId: null, tenant: null },
    { provider: 'microsoft', configured: false, clientId: null, tenant: 'common' }
  ]
  vi.spyOn(api.accounts, 'oauthStatus').mockImplementation(async () => statuses)

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <AppProvider>
        <App />
      </AppProvider>
    )
    await new Promise((resolve) => setTimeout(resolve, 80))
  })

  // Avatar menu > Manage accounts, exactly like a user.
  await act(async () => {
    document.querySelector<HTMLButtonElement>('.avatar-button')!.click()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  const manage = [...document.querySelectorAll<HTMLButtonElement>('.popover__item')].find((item) =>
    (item.textContent ?? '').includes('Manage accounts')
  )
  expect(manage).toBeTruthy()
  await act(async () => {
    manage!.click()
    await new Promise((resolve) => setTimeout(resolve, 120))
  })
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    (button.textContent ?? '').trim().toLowerCase().includes(text.toLowerCase())
  )
}

describe('Manage accounts screen', () => {
  it('offers Sign in again for an account that needs re-authorising', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openAccounts()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Your accounts')
    expect(buttonByText('Sign in again with Google')).toBeTruthy()
  })

  it('shows the sign-in providers section with a way to add a client ID', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openAccounts()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Sign-in providers (OAuth)')
    expect(text).toContain('Not configured')
    expect(buttonByText('Set up')).toBeTruthy()
  })

  it('surfaces a sign-in error instead of failing silently', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openAccounts()
    vi.spyOn(window.novamail!.api.accounts, 'reconnect').mockImplementation(async () => ({
      ok: false,
      error: 'Google sign-in is not configured yet. Add a Google OAuth client ID under Settings > Accounts > Sign-in providers.'
    }))

    const reconnectButton = buttonByText('Sign in again with Google')
    expect(reconnectButton).toBeTruthy()
    await act(async () => {
      reconnectButton!.click()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    const text = document.body.textContent ?? ''
    expect(text).toContain('not configured yet')
    // The account is still listed; nothing was removed or relabelled.
    expect(text).toContain('anna@gmail.example')
  })

  it('reports a cancelled sign-in as cancelled, not as success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openAccounts()
    vi.spyOn(window.novamail!.api.accounts, 'reconnect').mockImplementation(async () => ({
      ok: false,
      cancelled: true,
      error: 'Sign-in was cancelled.'
    }))

    await act(async () => {
      buttonByText('Sign in again with Google')!.click()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(document.body.textContent ?? '').toContain('Sign-in cancelled')
  })

  it('opens an edit dialog so a password or server can be changed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openAccounts()
    const update = vi
      .spyOn(window.novamail!.api.accounts, 'update')
      .mockImplementation(async () => oauthAccount)

    const edit = buttonByText('Edit')
    expect(edit).toBeTruthy()
    await act(async () => {
      edit!.click()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Incoming mail (IMAP)')
    expect(text).toContain('Outgoing mail (SMTP)')

    const save = buttonByText('Save changes')
    expect(save).toBeTruthy()
    await act(async () => {
      save!.click()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(update).toHaveBeenCalledTimes(1)
    const payload = update.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.id).toBe('oauth-1')
    expect(payload.email).toBe('anna@gmail.example')
    expect(payload.imap).toEqual({ host: 'imap.gmail.com', port: 993, secure: true })
    // An OAuth account has no password to send.
    expect(payload.password).toBeUndefined()
  })

  it('saves a client ID from the app and flips the provider to Ready', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openAccounts()
    const setOAuthClient = vi
      .spyOn(window.novamail!.api.accounts, 'setOAuthClient')
      .mockImplementation(async () => {
        statuses = [
          { provider: 'google', configured: true, clientId: '1234567890-...', tenant: null },
          statuses[1]!
        ]
        return statuses
      })

    await act(async () => {
      buttonByText('Set up')!.click()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="1234567890-abc.apps.googleusercontent.com"]'
    )
    expect(input).toBeTruthy()
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input!, '1234567890-abcdefgh.apps.googleusercontent.com')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    const save = buttonByText('Save client ID')
    expect(save).toBeTruthy()
    await act(async () => {
      save!.click()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(setOAuthClient).toHaveBeenCalledWith({
      provider: 'google',
      clientId: '1234567890-abcdefgh.apps.googleusercontent.com',
      tenant: undefined
    })
    expect(document.body.textContent ?? '').toContain('Ready')
  })
})
