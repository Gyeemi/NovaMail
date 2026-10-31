/**
 * Novamail - search query parsing and attachment classification.
 */
import { describe, expect, it } from 'vitest'
import { parseSearchQuery, buildFtsMatch, parsedToSearchParams, normalizeDate, parseSize } from '../../src/main/services/search/parse'
import {
  classifyAttachment,
  evaluateSafety,
  formatBytes,
  previewTypeFor,
  safeFilename
} from '../../src/shared/attachments'

describe('search query parsing', () => {
  it('splits operators from free text', () => {
    const parsed = parseSearchQuery('invoice from:sonam has:attachment after:2026-01-01')
    expect(parsed.from).toEqual(['sonam'])
    expect(parsed.hasAttachment).toBe(true)
    expect(parsed.after).toBeDefined()
    expect(parsed.freeText).toContain('invoice')
  })

  it('supports is:unread and is:starred', () => {
    expect(parseSearchQuery('is:unread').unreadOnly).toBe(true)
    expect(parseSearchQuery('is:read').readOnly).toBe(true)
    expect(parseSearchQuery('is:starred').starredOnly).toBe(true)
    expect(parseSearchQuery('is:important').importantOnly).toBe(true)
  })

  it('supports quoted phrases and keeps them intact', () => {
    const parsed = parseSearchQuery('"quarterly review" subject:notes')
    expect(parsed.freeText).toContain('quarterly review')
    expect(parsed.subject).toEqual(['notes'])
  })

  it('parses mailbox, label, filename and size operators', () => {
    const parsed = parseSearchQuery('in:archive label:Finance filename:pdf larger:2M')
    expect(parsed.mailbox).toBe('archive')
    expect(parsed.label).toBe('Finance')
    expect(parsed.filename).toBe('pdf')
    expect(parsed.largerThan).toBe(2 * 1024 * 1024)
  })

  it('reports unknown operators instead of silently ignoring them', () => {
    const parsed = parseSearchQuery('from:')
    expect(parsed.errors.length).toBeGreaterThan(0)
  })

  it('normalises relative dates and sizes', () => {
    expect(normalizeDate('today')).toBe(new Date().toISOString().slice(0, 10))
    expect(normalizeDate('yesterday')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(normalizeDate('3 days ago')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(normalizeDate('not-a-date')).toBeNull()
    expect(parseSize('500k')).toBe(500 * 1024)
    expect(parseSize('3mb')).toBe(3 * 1024 * 1024)
    expect(parseSize('nope')).toBeNull()
  })

  it('builds a safe FTS match expression', () => {
    expect(buildFtsMatch('report Q4')).toContain('"report"')
    expect(buildFtsMatch('   ')).toBeNull()
    // FTS operators must never be injected by the user.
    expect(buildFtsMatch('NOT OR *')).toBeNull()
  })

  it('maps a parsed query onto database filters', () => {
    const params = parsedToSearchParams(parseSearchQuery('from:sonam is:unread'), { q: 'from:sonam is:unread' })
    expect(params.from).toBe('sonam')
    expect(params.unreadOnly).toBe(true)
  })
})

describe('attachment classification', () => {
  it('recognises common kinds by extension and mime type', () => {
    expect(classifyAttachment('report.pdf', 'application/pdf')).toBe('pdf')
    expect(classifyAttachment('photo.JPG', 'image/jpeg')).toBe('image')
    expect(classifyAttachment('notes.txt', 'text/plain')).toBe('text')
    expect(classifyAttachment('data.csv', 'text/csv')).toBe('csv')
    expect(classifyAttachment('plan.docx', '')).toBe('document')
    expect(classifyAttachment('sheet.xlsx', '')).toBe('spreadsheet')
    expect(classifyAttachment('deck.pptx', '')).toBe('presentation')
    expect(classifyAttachment('voice.m4a', '')).toBe('audio')
    expect(classifyAttachment('clip.mp4', '')).toBe('video')
    expect(classifyAttachment('bundle.zip', 'application/zip')).toBe('archive')
    expect(classifyAttachment('invite.ics', 'text/calendar')).toBe('calendar')
    expect(classifyAttachment('mystery.dat', '')).toBe('unknown')
  })

  it('flags executables and macros as dangerous', () => {
    expect(evaluateSafety('setup.exe', 'application/octet-stream').level).toBe('dangerous')
    expect(evaluateSafety('invoice.pdf.exe', 'application/pdf').level).toBe('dangerous')
    expect(evaluateSafety('invoice.pdf.exe', 'application/pdf').reason).toContain('second extension')
    expect(evaluateSafety('budget.xlsm', 'application/vnd.ms-excel').level).toBe('caution')
    expect(evaluateSafety('photo.png', 'image/png').level).toBe('safe')
    expect(evaluateSafety('archive.zip', 'application/zip').level).toBe('caution')
  })

  it('declares preview support honestly', () => {
    expect(previewTypeFor('a.pdf', 'application/pdf').type).toBe('pdf')
    expect(previewTypeFor('a.docx', '').type).toBe('html')
    expect(previewTypeFor('a.xlsx', '').type).toBe('spreadsheet')
    expect(previewTypeFor('a.pptx', '').type).toBe('slides')
    expect(previewTypeFor('a.exe', '').type).toBe('unsupported')
    expect(previewTypeFor('a.doc', '').type).toBe('unsupported')
    expect(previewTypeFor('a.doc', '').limitation).toContain('.doc')
  })

  it('formats sizes and sanitises file names', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toMatch(/1[.,]5 KB/)
    expect(formatBytes(5 * 1024 * 1024)).toMatch(/5\.0 MB/)
    expect(safeFilename('../../etc/passwd')).toBe('passwd')
    expect(safeFilename('CON')).not.toBe('CON')
    expect(safeFilename('a'.repeat(400))).toHaveLength(150)
    expect(safeFilename('')).toBe('attachment')
    expect(safeFilename('report:final?.pdf')).not.toContain(':')
  })
})
