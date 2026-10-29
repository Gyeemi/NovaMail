/**
 * Novamail - MIME parsing tests: a real multipart message with an inline image,
 * an attached file, a list-unsubscribe header and a text-only alternative.
 */
import { describe, expect, it } from 'vitest'
import { parseRawMessage, makeSnippet, htmlToText, textToHtml } from '../../src/main/services/mail/parse'

const RAW = [
  'From: "Sonam Wangmo" <sonam.wangmo@example.com>',
  'To: Anna Dorji <anna@barailyinovex.example>',
  'Cc: tshering@example.com',
  'Subject: Quarterly review & next steps',
  'Date: Tue, 27 Oct 2026 09:15:00 +0000',
  'Message-ID: <abc123@example.com>',
  'In-Reply-To: <parent@example.com>',
  'References: <root@example.com> <parent@example.com>',
  'List-Unsubscribe: <https://example.com/unsubscribe?id=1>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="outer"',
  '',
  '--outer',
  'Content-Type: multipart/alternative; boundary="inner"',
  '',
  '--inner',
  'Content-Type: text/plain; charset="utf-8"',
  '',
  'Plain text version',
  'with two lines',
  '--inner',
  'Content-Type: text/html; charset="utf-8"',
  '',
  '<p>HTML version with an image <img src="cid:logo1" alt="logo"></p>',
  '--inner--',
  '',
  '--outer',
  'Content-Type: text/csv; name="figures.csv"',
  'Content-Disposition: attachment; filename="figures.csv"',
  'Content-Transfer-Encoding: base64',
  '',
  'cmVnaW9uLHJldmVudWUKUGFybywxMjg0MDAK',
  '--outer',
  'Content-Type: image/png',
  'Content-Disposition: inline; filename="logo.png"',
  'Content-ID: <logo1>',
  'Content-Transfer-Encoding: base64',
  '',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  '--outer--',
  ''
].join('\r\n')

describe('parseRawMessage', () => {
  it('reads the envelope', async () => {
    const message = await parseRawMessage(Buffer.from(RAW))
    expect(message.subject).toBe('Quarterly review & next steps')
    expect(message.from).toEqual({ name: 'Sonam Wangmo', address: 'sonam.wangmo@example.com' })
    expect(message.to[0]?.address).toBe('anna@barailyinovex.example')
    expect(message.cc[0]?.address).toBe('tshering@example.com')
    expect(message.messageId).toContain('abc123@example.com')
    expect(message.inReplyTo).toContain('parent@example.com')
    expect(message.references).toHaveLength(2)
    expect(message.listUnsubscribe).toContain('unsubscribe')
    expect(new Date(message.date).getUTCFullYear()).toBe(2026)
  })

  it('keeps both bodies', async () => {
    const message = await parseRawMessage(Buffer.from(RAW))
    expect(message.text).toContain('Plain text version')
    expect(message.html).toContain('HTML version')
  })

  it('extracts attachments with their bytes and content ids', async () => {
    const message = await parseRawMessage(Buffer.from(RAW))
    expect(message.attachments).toHaveLength(2)
    const csv = message.attachments.find((entry) => entry.filename === 'figures.csv')
    expect(csv?.mimeType).toContain('text/csv')
    expect(csv?.content.toString('utf8')).toContain('Paro,128400')
    const inline = message.attachments.find((entry) => entry.contentId === 'logo1')
    expect(inline?.disposition).toBe('inline')
    expect(inline?.content.length).toBeGreaterThan(50)
    expect(inline?.checksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it('detects remote content', async () => {
    const message = await parseRawMessage(
      Buffer.from(['Subject: x', 'Content-Type: text/html', '', '<img src="https://tracker.example/a.gif">'].join('\r\n'))
    )
    expect(message.hasRemoteContent).toBe(true)
  })

  it('never throws on a broken message', async () => {
    const message = await parseRawMessage(Buffer.from('not a real message at all'))
    expect(message.subject).toBe('')
    expect(message.attachments).toEqual([])
  })
})

describe('text helpers', () => {
  it('converts html to readable text', () => {
    const text = htmlToText('<p>Hello</p><p>World &amp; friends</p><script>bad()</script>')
    expect(text).toContain('Hello')
    expect(text).toContain('World & friends')
    expect(text).not.toContain('bad()')
  })

  it('escapes text when converting to html', () => {
    const html = textToHtml('<b>not bold</b>')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('truncates long snippets on a word boundary', () => {
    const snippet = makeSnippet('word '.repeat(200), null, 60)
    expect(snippet.length).toBeLessThanOrEqual(60)
  })
})
