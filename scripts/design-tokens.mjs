#!/usr/bin/env node
/**
 * Novamail - Figma design tokens to CSS custom properties.
 *
 * Arena.ai cannot reach Figma from this sandbox (see docs/DESIGN-WORKFLOW.md),
 * so designs travel as files: export the variables/tokens from Figma, commit the
 * JSON, and this converts them into the `--nm-*` custom properties the app uses.
 *
 *   npm run design:tokens            # write src/renderer/src/styles/tokens.generated.css
 *   npm run design:tokens -- --check # fail if the generated file is stale (used by CI)
 *
 * Input format is W3C Design Tokens (DTCG) as produced by Tokens Studio, Figma's
 * "Export variables" JSON, or written by hand:
 *
 *   {
 *     "light": { "color": { "accent": { "$value": "#3f7d8c", "$type": "color" } } },
 *     "dark":  { "color": { "accent": { "$value": "#63a3b1" } } }
 *   }
 *
 * A flat object without `light`/`dark` wrappers is treated as the light theme.
 * Aliases such as { "surface": { "$value": "{color.bg}" } } are resolved.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const DEFAULT_INPUT = path.join(ROOT, 'design', 'tokens.json')
const DEFAULT_OUTPUT = path.join(ROOT, 'src', 'renderer', 'src', 'styles', 'tokens.generated.css')
const THEMES = ['light', 'dark']

/* ------------------------------------------------------------------ parsing */

/** Values are interpolated into a stylesheet, so they must be plainly safe. */
function sanitizeValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Reject anything that could close the declaration or rule, or fetch a resource.
  if (/[;{}<>\\]/.test(trimmed)) return null
  if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(trimmed)) return null
  if (trimmed.length > 200) return null
  return trimmed
}

function kebab(segment) {
  return String(segment)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

/** `color.text.muted` -> `--nm-text-muted` (the leading `color` group is implied). */
function cssName(segments) {
  const parts = [...segments]
  if (parts.length > 1 && /^colou?rs?$/i.test(parts[0])) parts.shift()
  return `--nm-${parts.map(kebab).filter(Boolean).join('-')}`
}

/** Walks a token tree into { name: { value, type } }, resolving {alias} references. */
function flatten(node, trail = [], out = new Map()) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return out
  const hasValue = Object.hasOwn(node, '$value') || Object.hasOwn(node, 'value')
  if (hasValue) {
    const raw = Object.hasOwn(node, '$value') ? node.$value : node.value
    const type = node.$type ?? node.type ?? null
    out.set(cssName(trail), { raw, type, trail })
    return out
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    flatten(child, [...trail, key], out)
  }
  return out
}

/** Resolves `{a.b.c}` references, following chains, detecting cycles. */
function resolveTokens(tokens) {
  const resolved = new Map()
  const resolving = new Set()

  const lookup = (trail) => {
    const name = cssName(trail)
    return tokens.get(name)
  }

  const resolve = (name, stack = []) => {
    if (resolved.has(name)) return resolved.get(name)
    if (stack.includes(name)) {
      throw new Error(`circular token reference: ${[...stack, name].join(' -> ')}`)
    }
    const entry = tokens.get(name)
    if (!entry) return null
    resolving.add(name)

    let value = entry.raw
    if (typeof value === 'string') {
      const onlyAlias = /^\{\s*([^{}]+?)\s*\}$/.exec(value.trim())
      if (onlyAlias) {
        const trail = onlyAlias[1].split(/[./]/).map((part) => part.trim()).filter(Boolean)
        const target = lookup(trail)
        if (!target) throw new Error(`token ${name} references unknown token {${onlyAlias[1]}}`)
        value = resolve(target.trail.length ? cssName(target.trail) : name, [...stack, name])
      } else if (value.includes('{')) {
        // Mixed value such as "0 1px 2px {color.shadow}"
        value = value.replace(/\{\s*([^{}]+?)\s*\}/g, (_match, reference) => {
          const trail = reference.split(/[./]/).map((part) => part.trim()).filter(Boolean)
          const target = lookup(trail)
          if (!target) throw new Error(`token ${name} references unknown token {${reference}}`)
          const inner = resolve(cssName(target.trail), [...stack, name])
          return inner ?? ''
        })
      }
    }

    resolving.delete(name)
    const safe = sanitizeValue(value)
    resolved.set(name, safe)
    return safe
  }

  for (const name of tokens.keys()) resolve(name)
  return resolved
}

/* ------------------------------------------------------------------ output */

export function convert(document) {
  if (document === null || typeof document !== 'object') {
    throw new Error('tokens file must contain a JSON object')
  }
  const themes = {}
  const hasThemes = THEMES.some((theme) => document[theme] && typeof document[theme] === 'object')
  if (hasThemes) {
    for (const theme of THEMES) {
      const block = document[theme]
      if (!block || typeof block !== 'object') continue
      themes[theme] = resolveTokens(flatten(block))
    }
  } else {
    themes.light = resolveTokens(flatten(document))
  }

  const skipped = []
  const lines = [
    '/*',
    ' * GENERATED FILE - do not edit by hand.',
    ' * Source: design/tokens.json (exported from Figma)',
    ' * Regenerate: npm run design:tokens',
    ' */',
    ''
  ]

  const emit = (selector, map) => {
    const body = []
    for (const [name, value] of map) {
      if (!value) {
        skipped.push(name)
        continue
      }
      body.push(`  ${name}: ${value};`)
    }
    if (body.length === 0) return
    lines.push(`${selector} {`, ...body, '}', '')
  }

  if (themes.light?.size) emit(':root', themes.light)
  if (themes.dark?.size) emit(":root[data-theme='dark']", themes.dark)

  return { css: `${lines.join('\n')}\n`, counts: { light: themes.light?.size ?? 0, dark: themes.dark?.size ?? 0 }, skipped }
}

/* ---------------------------------------------------------------------- cli */

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, check: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') args.check = true
    else if (arg === '--input') args.input = path.resolve(argv[++i] ?? '')
    else if (arg === '--output') args.output = path.resolve(argv[++i] ?? '')
    else if (arg === '--help' || arg === '-h') args.help = true
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/design-tokens.mjs [--input design/tokens.json] [--output <file>] [--check]')
    return
  }

  if (!fs.existsSync(args.input)) {
    console.error(`No tokens file at ${path.relative(ROOT, args.input)}.`)
    console.error('Export the variables from Figma and save them there (see docs/DESIGN-WORKFLOW.md).')
    process.exit(2)
  }

  let document
  try {
    document = JSON.parse(fs.readFileSync(args.input, 'utf8'))
  } catch (error) {
    console.error(`Could not parse ${path.relative(ROOT, args.input)}: ${error.message}`)
    process.exit(2)
  }

  const { css, counts, skipped } = convert(document)

  if (skipped.length > 0) {
    console.warn(`Skipped ${skipped.length} token(s) with unsafe or empty values: ${skipped.join(', ')}`)
  }

  if (args.check) {
    const current = fs.existsSync(args.output) ? fs.readFileSync(args.output, 'utf8') : ''
    if (current !== css) {
      console.error(`${path.relative(ROOT, args.output)} is out of date. Run: npm run design:tokens`)
      process.exit(1)
    }
    console.log(`Design tokens are up to date (${counts.light} light, ${counts.dark} dark).`)
    return
  }

  fs.mkdirSync(path.dirname(args.output), { recursive: true })
  fs.writeFileSync(args.output, css)
  console.log(
    `Wrote ${path.relative(ROOT, args.output)}: ${counts.light} light token(s)` +
      (counts.dark ? `, ${counts.dark} dark token(s)` : '') +
      '.'
  )
}

/*
 * Run only when executed directly.
 *
 * Do not compare against `file://${process.argv[1]}`: on Windows that produces
 * `file://C:\dir\script.mjs` while import.meta.url is `file:///C:/dir/script.mjs`,
 * so main() would never run and the script would exit 0 having done nothing.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
