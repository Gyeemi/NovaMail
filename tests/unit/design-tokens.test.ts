/**
 * Novamail - design token converter.
 *
 * The converter is the bridge between Figma and the app (Arena cannot reach
 * Figma directly, see docs/DESIGN-WORKFLOW.md), so it is tested through its real
 * CLI: write a tokens file, run it, read the stylesheet it produces.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(import.meta.dirname, '../../scripts/design-tokens.mjs')
let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novamail-tokens-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function run(tokens: unknown, extra: string[] = []): string {
  const input = path.join(dir, 'tokens.json')
  const output = path.join(dir, 'out.css')
  fs.writeFileSync(input, JSON.stringify(tokens))
  execFileSync(process.execPath, [SCRIPT, '--input', input, '--output', output, ...extra], {
    encoding: 'utf8'
  })
  return fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : ''
}

describe('design token conversion', () => {
  it('maps token paths to --nm- custom properties', () => {
    const css = run({
      light: {
        color: {
          accent: { $value: '#3f7d8c', $type: 'color' },
          text: { muted: { $value: '#5f6f7d' } }
        }
      }
    })
    expect(css).toContain('--nm-accent: #3f7d8c;')
    expect(css).toContain('--nm-text-muted: #5f6f7d;')
    expect(css).toContain(':root {')
  })

  it('emits a separate dark block that overrides only what it defines', () => {
    const css = run({
      light: { color: { bg: { $value: '#eef2f6' }, accent: { $value: '#3f7d8c' } } },
      dark: { color: { bg: { $value: '#161b21' } } }
    })
    expect(css).toMatch(/:root\[data-theme='dark'\] \{\n\s+--nm-bg: #161b21;/)
    // accent is not defined for dark, so it must not be repeated there
    const darkBlock = css.slice(css.indexOf("[data-theme='dark']"))
    expect(darkBlock).not.toContain('--nm-accent')
  })

  it('resolves aliases and chained aliases', () => {
    const css = run({
      light: {
        color: { accent: { $value: '#3f7d8c' }, brand: { $value: '{color.accent}' } },
        focusRing: { $value: '0 0 0 2px {color.brand}' }
      }
    })
    expect(css).toContain('--nm-brand: #3f7d8c;')
    expect(css).toContain('--nm-focus-ring: 0 0 0 2px #3f7d8c;')
  })

  it('rejects values that could inject CSS', () => {
    const css = run({
      light: {
        color: {
          ok: { $value: '#3f7d8c' },
          evil: { $value: 'red; } body { display: none' },
          sneaky: { $value: 'url(https://tracker.example/a.png)' }
        }
      }
    })
    expect(css).toContain('--nm-ok: #3f7d8c;')
    expect(css).not.toContain('display: none')
    expect(css).not.toContain('tracker.example')
  })

  it('reports a circular reference instead of emitting junk', () => {
    expect(() =>
      run({ light: { a: { $value: '{b}' }, b: { $value: '{a}' } } })
    ).toThrow(/circular token reference/)
  })

  it('fails on a reference to a token that does not exist', () => {
    expect(() => run({ light: { a: { $value: '{nope}' } } })).toThrow(/unknown token/)
  })

  it('answers --check when the output is current and fails when it is stale', () => {
    const input = path.join(dir, 'tokens.json')
    const output = path.join(dir, 'out.css')
    fs.writeFileSync(input, JSON.stringify({ light: { accent: { $value: '#3f7d8c' } } }))
    execFileSync(process.execPath, [SCRIPT, '--input', input, '--output', output], { encoding: 'utf8' })

    const current = execFileSync(process.execPath, [SCRIPT, '--input', input, '--output', output, '--check'], {
      encoding: 'utf8'
    })
    expect(current).toContain('up to date')

    fs.writeFileSync(output, '/* edited */\n')
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, '--input', input, '--output', output, '--check'], { encoding: 'utf8' })
    ).toThrow()
  })

  it('actually runs its CLI entry point (a no-op entry guard would hide here)', () => {
    // Regression: the script compared import.meta.url against
    // `file://${process.argv[1]}`, which never matches on Windows, so every test
    // below silently saw an empty stylesheet and CI failed only on the Windows
    // runner. Asserting on --help output proves main() is reachable.
    const output = execFileSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' })
    expect(output).toContain('Usage: node scripts/design-tokens.mjs')
  })

  it('treats a flat file without theme wrappers as light', () => {
    const css = run({ color: { accent: { $value: '#123456' } } })
    expect(css).toContain('--nm-accent: #123456;')
    expect(css).not.toContain("[data-theme='dark']")
  })
})
