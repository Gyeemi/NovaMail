/**
 * Novamail - structured local logger.
 *
 * - JSON-lines format, one file per day with size based rotation
 * - secrets and message bodies are redacted before writing
 * - in-memory ring buffer for the diagnostics screen
 */
import fs from 'node:fs'
import path from 'node:path'
import { redact, scrubText, truncate } from './redact'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  child(scope: string): Logger
  readonly scope: string
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_FILES = 5
const RING_SIZE = 400

const ringBuffer: string[] = []
let activeLevel: LogLevel = process.env.NOVAMAIL_LOG_LEVEL === 'debug' ? 'debug' : 'info'
let logDir: string | null = null
let stream: fs.WriteStream | null = null
let currentSize = 0
let currentDay = ''

export function configureLogger(options: {
  dir?: string
  level?: LogLevel
  console?: boolean
}): { dir: string | null; level: LogLevel } {
  logDir = options.dir ?? null
  if (options.level) activeLevel = options.level
  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true })
    pruneOldFiles()
    openStream()
  }
  return { dir: logDir, level: activeLevel }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function currentFile(): string {
  if (!logDir) return ''
  return path.join(logDir, `novamail-${today()}.log`)
}

function openStream(): void {
  if (!logDir) return
  const file = currentFile()
  try {
    const stat = fs.existsSync(file) ? fs.statSync(file) : null
    currentSize = stat?.size ?? 0
    currentDay = today()
    stream = fs.createWriteStream(file, { flags: 'a' })
  } catch {
    stream = null
  }
}

function rotateIfNeeded(): void {
  if (!stream || !logDir) return
  if (currentSize < MAX_FILE_BYTES && currentDay === today()) return
  stream.end()
  if (currentDay !== today()) {
    currentSize = 0
    currentDay = today()
    openStream()
    pruneOldFiles()
    return
  }
  const file = currentFile()
  const rotated = `${file}.${Date.now()}.bak`
  try {
    fs.renameSync(file, rotated)
  } catch {
    /* ignore */
  }
  currentSize = 0
  openStream()
  pruneOldFiles()
}

function pruneOldFiles(): void {
  if (!logDir) return
  try {
    const files = fs
      .readdirSync(logDir)
      .filter((f) => f.startsWith('novamail-') && f.endsWith('.log'))
      .sort()
    while (files.length > MAX_FILES) {
      const oldest = files.shift()
      if (oldest) fs.rmSync(path.join(logDir, oldest), { force: true })
    }
    // also prune rotated .bak files
    const baks = fs
      .readdirSync(logDir)
      .filter((f) => f.includes('.log.') && f.endsWith('.bak'))
      .sort()
    while (baks.length > MAX_FILES) {
      const oldest = baks.shift()
      if (oldest) fs.rmSync(path.join(logDir, oldest), { force: true })
    }
  } catch {
    /* ignore */
  }
}

function write(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[activeLevel]) return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    msg: scrubText(truncate(message, 2000)),
    ...(meta ? { meta: redact(meta) } : {})
  })
  ringBuffer.push(line)
  if (ringBuffer.length > RING_SIZE) ringBuffer.shift()

  if (process.env.NOVAMAIL_LOG_CONSOLE === '1' || !stream) {
    const printable = `[${level}] ${scope}: ${message}`
    if (level === 'error') console.error(printable, meta ? redact(meta) : '')
    else if (level === 'warn') console.warn(printable, meta ? redact(meta) : '')
    else console.log(printable)
  }

  rotateIfNeeded()
  if (stream) {
    stream.write(`${line}\n`)
    currentSize += line.length + 1
  }
}

export function getLogTail(limit = 200): string[] {
  return ringBuffer.slice(-limit)
}

export function createLogger(scope: string): Logger {
  return {
    scope,
    debug: (m, meta) => write('debug', scope, m, meta),
    info: (m, meta) => write('info', scope, m, meta),
    warn: (m, meta) => write('warn', scope, m, meta),
    error: (m, meta) => write('error', scope, m, meta),
    child: (sub: string) => createLogger(`${scope}:${sub}`)
  }
}

export const rootLogger = createLogger('main')
