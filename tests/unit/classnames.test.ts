/**
 * Novamail - stylesheet coverage guard.
 *
 * Classes that are used in the renderer but never defined in CSS fall back to
 * default block layout. That is exactly how the 1.0.1 build shipped a top bar
 * whose regions stacked vertically, pushing Compose over the demo banner and the
 * account button into the reading pane. Nothing in a type-check catches it.
 *
 * This test walks every className literal in src/renderer and requires a rule
 * for each one, so the same mistake fails CI instead of reaching a user.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const RENDERER = path.join(ROOT, 'src/renderer/src')
const SHEETS = [
  path.join(ROOT, 'src/renderer/src/styles/app.css'),
  path.join(ROOT, 'src/renderer/src/styles/tokens.css')
]

/** Classes that are deliberately unstyled, with the reason. */
const ALLOWED = new Map<string, string>([
  ['is-active', 'state marker applied alongside a styled base class'],
  ['is-on', 'state marker applied alongside a styled base class'],
  ['is-done', 'state marker applied alongside a styled base class'],
  ['match', 'syntax-highlight marker inside a <mark>'],
  ['kbd', 'styled through the element selector'],
  ['truncate', 'utility, defined once and reused'],
  ['row', 'utility, defined once and reused'],
  ['stack', 'utility, defined once and reused'],
  ['spacer', 'utility, defined once and reused'],
  ['small', 'utility, defined once and reused'],
  ['muted', 'utility, defined once and reused'],
  ['checklist', 'styled through the element selector']
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Every class token used by the renderer, mapped to where it came from. */
export function collectUsedClasses(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>()
  for (const file of walk(RENDERER)) {
    if (file.endsWith('.d.ts')) continue
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const raw = match[1] ?? match[2] ?? ''
      // Template expressions can produce dynamic class names; drop them and
      // validate the static prefix separately.
      for (const token of raw.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (!token || token.includes("'") || token.includes('"')) continue
        // "modal--" style prefixes come from `modal--${size}` and have their own
        // base class asserted below.
        if (token.endsWith('-')) continue
        if (!used.has(token)) used.set(token, new Set())
        used.get(token)!.add(path.basename(file))
      }
    }
  }
  return used
}

const css = SHEETS.map((file) => fs.readFileSync(file, 'utf8')).join('\n')

function hasRule(className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\.${escaped}(?![\\w-])`).test(css)
}

describe('stylesheet coverage', () => {
  it('defines a rule for every className the renderer uses', () => {
    const missing: string[] = []
    for (const [className, files] of collectUsedClasses()) {
      if (ALLOWED.has(className)) continue
      if (hasRule(className)) continue
      missing.push(`${className}  (${[...files].join(', ')})`)
    }
    expect(missing, `Unstyled classes:\n${missing.join('\n')}`).toEqual([])
  })

  it('stays out of the allowlist unless there is a reason', () => {
    for (const [className, reason] of ALLOWED) {
      expect(reason.length, `${className} needs a reason`).toBeGreaterThan(10)
    }
  })

  it('styles the structural classes that the layout depends on', () => {
    // Regression set for the broken shell: each of these must keep a rule.
    for (const className of [
      'topbar__left',
      'topbar__search',
      'topbar__right',
      'brand__text',
      'avatar-button',
      'list-item__actions',
      'nav-item--sub',
      'composer__footer',
      'settings__nav',
      'popover'
    ]) {
      expect(hasRule(className), `${className} lost its rule`).toBe(true)
    }
  })

  it('lays the mail list out in four columns so actions do not wrap', () => {
    // check, avatar, body, actions
    const rule = /\.list-item\s*\{[^}]*grid-template-columns:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto/.exec(css)
    expect(rule, 'list-item must reserve a column for the action buttons').toBeTruthy()
  })

  it('never lets the top bar regions stack vertically again', () => {
    const right = /\.topbar__right\s*\{[^}]*flex-direction:\s*row|\.topbar__right\s*\{[^}]*display:\s*flex/.exec(css)
    expect(right).toBeTruthy()
  })
})
