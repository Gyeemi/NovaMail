// @vitest-environment jsdom
/**
 * Novamail - modal typing regression test.
 *
 * Bug being guarded against: `Modal`'s focus effect depended on `onClose`, which
 * callers pass as an inline arrow. A new identity on every render meant the
 * effect re-ran after each keystroke and re-focused the dialog's first control,
 * pulling the caret out of the field the user was typing in. In the packaged app
 * that made every dialog (add account, rule editor, contact editor...) accept
 * exactly one character.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Modal } from '@renderer/components/ui'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let container: HTMLDivElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  document.body.innerHTML = ''
})

function mount(element: React.ReactElement): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(element))
}

/** Types into an input the way a user does, one character at a time. */
function typeInto(input: HTMLInputElement, text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  for (const char of text) {
    act(() => {
      setValue.call(input, input.value + char)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
}

function Harness({ onClosed }: { onClosed?: () => void }) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <Modal
      title="Add account"
      // Inline arrow on purpose: this is exactly what every call site does.
      onClose={() => {
        setOpen(false)
        onClosed?.()
      }}
      footer={<button type="button">Continue</button>}
    >
      <label htmlFor="email">Email address</label>
      <input
        id="email"
        value={value}
        aria-label="Email address"
        onChange={(event) => setValue(event.target.value)}
      />
    </Modal>
  )
}

describe('Modal focus and typing', () => {
  it('focuses the first form field when it opens', () => {
    mount(<Harness />)
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Email address"]')!
    expect(document.activeElement).toBe(input)
  })

  it('keeps focus and accepts every character while typing', () => {
    mount(<Harness />)
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Email address"]')!

    typeInto(input, 'anna@barailyinovex.example')

    // The regression: after the first keystroke focus jumped to the close button.
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('anna@barailyinovex.example')
  })

  it('does not lose focus on a re-render caused by unrelated state', () => {
    mount(<Harness />)
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Email address"]')!
    typeInto(input, 'a')
    act(() => root!.render(<Harness />))
    expect(document.activeElement).toBe(input)
  })

  it('still closes on Escape and on the close button', () => {
    let closed = 0
    mount(<Harness onClosed={() => (closed += 1)} />)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toBe(1)

    // Remount, then use the header button.
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root!.render(<Harness onClosed={() => (closed += 1)} />))
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
    act(() => close.click())
    expect(closed).toBe(2)
  })
})
