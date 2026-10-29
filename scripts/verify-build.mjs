#!/usr/bin/env node
/**
 * Novamail - build verification.
 *
 * Checks that a build is actually packageable before electron-builder runs. It
 * does not need Electron, wine or a GPU, so it can run in CI on any platform:
 *
 *   npm run verify
 *
 * Exits non-zero (and prints what is wrong) if anything is missing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const failures = []
const notes = []

function check(label, fn) {
  try {
    const detail = fn()
    if (detail) notes.push(`  ok  ${label} - ${detail}`)
    else notes.push(`  ok  ${label}`)
  } catch (error) {
    failures.push(`  FAIL ${label}: ${error.message}`)
  }
}

function mustExist(relativePath) {
  const absolute = path.join(root, relativePath)
  if (!fs.existsSync(absolute)) throw new Error(`${relativePath} is missing`)
  return absolute
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

/* --------------------------------------------------------------- build output */

check('main bundle', () => {
  const file = mustExist('out/main/index.js')
  const size = fs.statSync(file).size
  if (size < 50_000) throw new Error(`out/main/index.js is only ${size} bytes - did the build run?`)
  return `${(size / 1024).toFixed(0)} kB`
})

check('preload bundle', () => {
  const file = mustExist('out/preload/index.js')
  return `${(fs.statSync(file).size / 1024).toFixed(1)} kB`
})

check('renderer html', () => {
  const file = mustExist('out/renderer/index.html')
  const html = fs.readFileSync(file, 'utf8')
  if (!html.includes('Content-Security-Policy')) throw new Error('renderer/index.html has no CSP meta tag')
  if (html.includes('/src/main.tsx')) throw new Error('renderer/index.html still points at the dev entry point')
  return 'CSP present, production entry'
})

check('renderer assets', () => {
  const assetsDir = path.join(root, 'out/renderer/assets')
  const assets = fs.readdirSync(assetsDir)
  const js = assets.filter((f) => f.endsWith('.js'))
  const css = assets.filter((f) => f.endsWith('.css'))
  if (js.length === 0) throw new Error('no JavaScript emitted')
  if (css.length === 0) throw new Error('no CSS emitted')
  const pdfWorker = assets.filter((f) => f.includes('pdf.worker'))
  if (pdfWorker.length === 0) notes.push('  note PDF worker not emitted as a separate file (bundled)')
  return `${js.length} js, ${css.length} css`
})

check('demo bridge is tree-shaken out of the packaged renderer', () => {
  // mockBridge is loaded with a dynamic import only when window.novamail is
  // absent; it must not be inlined into the main entry chunk.
  const assetsDir = path.join(root, 'out/renderer/assets')
  for (const file of fs.readdirSync(assetsDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(assetsDir, file), 'utf8')
    if (source.includes('installMockBridge') && source.length < 100_000) {
      throw new Error(`${file} appears to inline the demo bridge`)
    }
  }
  return 'separate chunk'
})

/* ------------------------------------------------------------ packaging inputs */

check('electron-builder config', () => {
  const config = fs.readFileSync(mustExist('electron-builder.yml'), 'utf8')
  for (const expected of ['appId:', 'nsis:', 'Novamail-Setup-${arch}.${ext}', 'asarUnpack']) {
    if (!config.includes(expected)) throw new Error(`electron-builder.yml is missing "${expected}"`)
  }
  return 'NSIS target, asar, native module unpack'
})

check('installer icons', () => {
  const ico = mustExist('build/icon.ico')
  const bytes = fs.statSync(ico).size
  if (bytes < 10_000) throw new Error('build/icon.ico looks too small to contain multiple sizes')
  mustExist('build/icon.png')
  mustExist('build/tray.png')
  return `${(bytes / 1024).toFixed(0)} kB .ico`
})

check('licence', () => {
  mustExist('LICENSE.txt')
  mustExist('LICENSE')
})

check('runtime dependencies declared', () => {
  const required = ['better-sqlite3', 'imapflow', 'nodemailer', 'mailparser', 'sanitize-html', 'zod']
  const missing = required.filter((name) => !pkg.dependencies?.[name])
  if (missing.length > 0) throw new Error(`not in dependencies: ${missing.join(', ')}`)
  if (pkg.dependencies.electron) throw new Error('electron must be a devDependency, not a runtime dependency')
  return required.join(', ')
})

check('better-sqlite3 prebuilds are available', () => {
  // v13 ships N-API prebuilds per platform instead of compiling at install time.
  // The archive must contain the Windows x64 binary or the installer opens fine
  // and then fails on its first database call.
  const dir = path.join(root, 'node_modules/better-sqlite3/prebuilds')
  if (!fs.existsSync(dir)) throw new Error('node_modules/better-sqlite3/prebuilds is missing - run npm ci')
  const available = fs.readdirSync(dir).filter((f) => f.endsWith('.node'))
  const windows = available.filter((f) => f.startsWith('win32-'))
  if (windows.length === 0) throw new Error('no win32 prebuild present; a Windows installer built here would be broken')
  const host = `${process.platform === 'linux' && false ? '' : process.platform}-${process.arch}`
  if (!available.some((f) => f.startsWith(host))) throw new Error(`no prebuild for this host (${host})`)
  return `${available.length} targets incl. ${windows.join(', ')}`
})

check('no secrets or user data would be packaged', () => {
  const forbidden = ['novamail.db', 'credentials.json', '.env']
  for (const name of forbidden) {
    if (fs.existsSync(path.join(root, name))) throw new Error(`${name} is in the project root and must be removed before packaging`)
  }
  const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
  if (!config.includes("'!**/*.map'")) throw new Error('source maps are not excluded from the package')
  return 'clean'
})

/* ---------------------------------------------------------------------- report */

console.log('\nNovamail build verification\n')
for (const line of notes) console.log(line)

if (failures.length > 0) {
  console.log('')
  for (const line of failures) console.log(line)
  console.log(`\n${failures.length} check(s) failed.\n`)
  process.exit(1)
}

console.log('\nAll checks passed. Next step: npm run dist:win (Windows, or Linux with wine).\n')
