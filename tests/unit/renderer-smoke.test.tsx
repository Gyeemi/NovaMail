// @vitest-environment jsdom
/**
 * Novamail - renderer smoke test.
 *
 * Renders the real application shell against the demo bridge and checks that the
 * three-pane interface comes up, that a message can be opened, and that the
 * composer opens. This catches the class of bugs a type-check cannot: missing
 * bridge methods, bad hooks, and crashes during first paint.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from '@renderer/App'
import { AppProvider } from '@renderer/state/AppProvider'
import { installMockBridge } from '@renderer/mockBridge'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let container: HTMLDivElement
let root: Root | null = null

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
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async () => undefined },
    configurable: true
  })

  if (!window.novamail) installMockBridge()
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  document.body.innerHTML = ''
})

async function renderApp(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <AppProvider>
        <App />
      </AppProvider>
    )
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
  // Allow the second wave of async loads (folders, labels, list) to settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}

describe('application shell', () => {
  it('mounts the demo bridge when Electron is not present', () => {
    expect(window.novamail).toBeTruthy()
    expect(typeof window.novamail?.api.messages.list).toBe('function')
    expect(typeof window.novamail?.system.getPathForFile).toBe('function')
  })

  it('renders the top bar, sidebar and message list', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderApp()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Email, made effortless')
    expect(text).toContain('Unified inbox')
    expect(text).toContain('Browser preview')
    expect(document.querySelectorAll('[data-message-id]').length).toBeGreaterThan(0)
  })

  it('opens a message in the reading pane', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderApp()
    const first = document.querySelector<HTMLElement>('[data-message-id]')
    expect(first).toBeTruthy()
    await act(async () => {
      first!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    const reader = document.querySelector('.reading-pane')
    expect(reader).toBeTruthy()
    expect(document.querySelectorAll('.attachment-card').length).toBeGreaterThan(0)
  })

  it('opens the composer from the top bar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderApp()
    const composeButton = Array.from(document.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').toLowerCase().includes('compose')
    )
    expect(composeButton).toBeTruthy()
    await act(async () => {
      composeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(document.querySelector('.composer')).toBeTruthy()
  })
})
