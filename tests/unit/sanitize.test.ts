/**
 * Novamail - HTML sanitiser tests.
 *
 * Email is hostile input. Each test names the attack it prevents.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml, extractRemoteImageUrls, INLINE_BLANK_PIXEL } from '../../src/main/services/mail/sanitize'

describe('sanitizeEmailHtml', () => {
  it('removes script tags and their content', () => {
    const result = sanitizeEmailHtml('<p>Hello</p><script>alert(document.cookie)</script>')
    expect(result.html).not.toContain('alert')
    expect(result.html).not.toContain('<script')
    expect(result.html).toContain('Hello')
    expect(result.removedActiveContent).toBe(true)
  })

  it('removes event handler attributes', () => {
    const result = sanitizeEmailHtml('<img src="cid:a" onerror="fetch(\'https://evil.example\')"/>')
    expect(result.html).not.toContain('onerror')
    expect(result.html).not.toContain('evil.example')
  })

  it('removes iframes, objects, embeds and forms', () => {
    const result = sanitizeEmailHtml(
      '<iframe src="https://evil.example"></iframe><object data="x.swf"></object><embed src="y"><form action="https://evil.example"><input name="p"/></form>'
    )
    expect(result.html).not.toMatch(/iframe|object|embed|form|input/i)
    expect(result.removedActiveContent).toBe(true)
  })

  it('drops javascript: and data: links but keeps real ones', () => {
    const result = sanitizeEmailHtml(
      '<a href="javascript:alert(1)">bad</a><a href="data:text/html;base64,PHNjcmlwdD4=">data</a><a href="https://example.com">good</a>'
    )
    expect(result.html).not.toContain('javascript:')
    expect(result.html).not.toMatch(/href="data:/i)
    expect(result.html).toContain('https://example.com')
  })

  it('blocks remote images by default and remembers the address', () => {
    const result = sanitizeEmailHtml('<p>Hi</p><img src="https://tracker.example/pixel.gif" alt="logo">')
    expect(result.blockedRemoteCount).toBe(1)
    expect(result.html).toContain(INLINE_BLANK_PIXEL)
    expect(result.html).toContain('data-blocked-src="https://tracker.example/pixel.gif"')
    // The tracking URL is kept as metadata only, never as a loadable image source.
    expect(result.html).toMatch(/<img[^>]*src="data:image\/gif/)
  })

  it('allows remote images when the reader explicitly consents', () => {
    const result = sanitizeEmailHtml('<img src="https://cdn.example/logo.png">', { allowRemoteImages: true })
    expect(result.blockedRemoteCount).toBe(0)
    expect(result.html).toContain('https://cdn.example/logo.png')
  })

  it('rewrites cid: images to the local attachment protocol', () => {
    const result = sanitizeEmailHtml('<img src="cid:logo@example">', {
      cidMap: { 'logo@example': 'novamail-att://attachment/att-1' }
    })
    expect(result.html).toContain('novamail-att://attachment/att-1')
    expect(result.html).not.toContain('cid:logo@example')
  })

  it('strips layout-breaking CSS but keeps readable formatting', () => {
    const result = sanitizeEmailHtml(
      '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:red;font-weight:bold">overlay</div>'
    )
    expect(result.html).not.toContain('position:fixed')
    expect(result.html).not.toContain('position:absolute')
    expect(result.html).not.toContain('z-index')
    expect(result.html).toContain('font-weight:bold')
  })

  it('handles empty and pathological input', () => {
    expect(sanitizeEmailHtml(null).html).toBe('')
    expect(sanitizeEmailHtml(undefined).html).toBe('')
    const deep = '<div>'.repeat(400) + 'x' + '</div>'.repeat(400)
    expect(() => sanitizeEmailHtml(deep)).not.toThrow()
  })

  it('extracts distinct remote image urls', () => {
    const sanitized = sanitizeEmailHtml(
      '<img src="https://a.example/1.png"><img src="http://b.example/2.png"><img src="cid:x"><img src="https://a.example/1.png">'
    )
    const urls = extractRemoteImageUrls(sanitized.html)
    expect(urls).toHaveLength(2)
    expect(urls).toContain('https://a.example/1.png')
  })
})
