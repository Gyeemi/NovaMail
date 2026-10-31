/**
 * Novamail - HTML sanitiser for untrusted email content.
 *
 * Email is hostile input. The sanitiser:
 *  - removes <script>, <iframe>, <object>, <embed>, <form>, <meta>, <base>, event handlers
 *  - allows only a safe subset of CSS (no position/fixed/transform/overlay tricks)
 *  - rewrites cid: images to the local attachment scheme
 *  - blocks remote images by default (tracking protection) while remembering the URL
 *  - forces links through the external-link handler
 *
 * The result is rendered inside a sandboxed iframe with no script permission, so
 * even a sanitiser miss cannot execute code or reach the local file system.
 */
import sanitizeHtml from 'sanitize-html'
import { createLogger } from '../../util/logger'

const log = createLogger('sanitize')

export const INLINE_BLANK_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const ALLOWED_TAGS = [
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'big',
  'blockquote',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'tt',
  'u',
  'ul',
  'var',
  'wbr'
]

const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel', 'cid', 'data', 'novamail-att']

export interface SanitizeOptions {
  /** allow http(s) images to load directly (only after explicit user consent) */
  allowRemoteImages?: boolean
  /** content-id -> local URL (novamail-att:...) */
  cidMap?: Record<string, string>
}

export interface SanitizeResult {
  html: string
  blockedRemoteCount: number
  removedActiveContent: boolean
}

const ACTIVE_PATTERNS = [/<\s*script/i, /<\s*iframe/i, /<\s*object/i, /<\s*embed/i, /on\w+\s*=/i, /<\s*form/i]

export function sanitizeEmailHtml(input: string | null | undefined, options: SanitizeOptions = {}): SanitizeResult {
  if (!input) return { html: '', blockedRemoteCount: 0, removedActiveContent: false }
  const { allowRemoteImages = false, cidMap = {} } = options
  let blockedRemoteCount = 0
  let removedActiveContent = false

  for (const pattern of ACTIVE_PATTERNS) {
    if (pattern.test(input)) removedActiveContent = true
  }

  const isRemote = (src: string): boolean => /^(https?:)?\/\//i.test(src.trim())

  const html = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'border', 'data-blocked-src', 'style'],
      '*': ['style', 'class', 'align', 'valign', 'dir', 'lang', 'width', 'height', 'colspan', 'rowspan', 'bgcolor']
    },
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data', 'novamail-att'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template'],
    allowedStyles: {
      '*': {
        color: [/^#(0x)?[0-9a-f]+$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z-]+$/i],
        'background-color': [/^#(0x)?[0-9a-f]+$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z-]+$/i],
        'background-image': [/^none$/i],
        'font-family': [/^[\w\s,'"-]+$/],
        'font-size': [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
        'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/],
        'font-style': [/^(normal|italic|oblique)$/],
        'text-decoration': [/^(none|underline|line-through|overline|underline line-through)$/],
        'text-align': [/^(left|right|center|justify|start|end)$/],
        'vertical-align': [/^(top|middle|bottom|baseline)$/],
        'line-height': [/^\d+(\.\d+)?(px|pt|em|%)?$/],
        'letter-spacing': [/^-?\d+(\.\d+)?(px|em)$/],
        margin: [/^\d+(\.\d+)?(px|pt|em|%)?(\s+\d+(\.\d+)?(px|pt|em|%)?){0,3}$/],
        'margin-top': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'margin-bottom': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'margin-left': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'margin-right': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        padding: [/^\d+(\.\d+)?(px|pt|em|%)?(\s+\d+(\.\d+)?(px|pt|em|%)?){0,3}$/],
        'padding-top': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'padding-bottom': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'padding-left': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'padding-right': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'border-radius': [/^\d+(\.\d+)?(px|%)$/],
        border: [/^[\w\s#().,%]+$/],
        'border-top': [/^[\w\s#().,%]+$/],
        'border-bottom': [/^[\w\s#().,%]+$/],
        'border-left': [/^[\w\s#().,%]+$/],
        'border-right': [/^[\w\s#().,%]+$/],
        'border-collapse': [/^(collapse|separate)$/],
        'border-color': [/^[\w\s#(),.%]+$/],
        'border-style': [/^(none|solid|dashed|dotted|double)$/],
        'border-width': [/^\d+(\.\d+)?(px|pt)$/],
        width: [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'max-width': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        height: [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'max-height': [/^\d+(\.\d+)?(px|pt|em|%)$/],
        'white-space': [/^(normal|nowrap|pre|pre-wrap|pre-line)$/],
        'word-break': [/^(normal|break-all|keep-all|break-word)$/],
        'overflow-wrap': [/^(normal|break-word|anywhere)$/],
        display: [/^(block|inline|inline-block|table|table-row|table-cell|none|list-item)$/],
        float: [/^(none|left|right)$/],
        direction: [/^(ltr|rtl)$/]
      }
    },
    transformTags: {
      a: (tagName, attribs) => {
        // Drop the original href before rebuilding it, otherwise an unsafe value
        // (javascript:, data:) could survive alongside the sanitised one.
        const { href, ...rest } = attribs
        const candidate = (href ?? '').trim()
        const safeHref = /^(https?:|mailto:|tel:)/i.test(candidate) || candidate.startsWith('#') ? candidate : ''
        const attrs: Record<string, string> = {
          ...rest,
          target: '_blank',
          rel: 'noopener noreferrer nofollow'
        }
        if (safeHref) attrs.href = safeHref
        return { tagName: 'a', attribs: attrs }
      },
      img: (tagName, attribs) => {
        const src = (attribs.src ?? '').trim()
        const cidMatch = /^cid:(.+)$/i.exec(src)
        if (cidMatch) {
          const key = decodeURIComponent(cidMatch[1]!).replace(/^<|>$/g, '')
          const local = cidMap[key] ?? cidMap[`${key}`.toLowerCase()]
          if (local) return { tagName: 'img', attribs: { ...attribs, src: local } }
          // inline image that is not in the message: drop the source but keep layout
          return { tagName: 'img', attribs: { ...attribs, src: INLINE_BLANK_PIXEL, alt: attribs.alt ?? '' } }
        }
        if (isRemote(src)) {
          if (allowRemoteImages) {
            return { tagName: 'img', attribs: { ...attribs, src: src.startsWith('//') ? `https:${src}` : src } }
          }
          blockedRemoteCount += 1
          return {
            tagName: 'img',
            attribs: {
              ...attribs,
              src: INLINE_BLANK_PIXEL,
              'data-blocked-src': src,
              class: `${attribs.class ?? ''} nm-blocked-image`.trim(),
              alt: attribs.alt ? `${attribs.alt} (remote image blocked)` : 'Remote image blocked'
            }
          }
        }
        if (src.startsWith('data:')) {
          // only images, never scripts
          if (!/^data:image\//i.test(src)) return { tagName: 'img', attribs: { ...attribs, src: INLINE_BLANK_PIXEL } }
          return { tagName: 'img', attribs }
        }
        return { tagName: 'img', attribs: { ...attribs, src: INLINE_BLANK_PIXEL } }
      }
    }
  })

  if (blockedRemoteCount > 0) log.debug('remote images blocked', { count: blockedRemoteCount })
  return { html, blockedRemoteCount, removedActiveContent }
}

/** Lists the remote image URLs present in sanitised HTML (used by "show images"). */
export function extractRemoteImageUrls(html: string): string[] {
  const urls = new Set<string>()
  const regex = /data-blocked-src="([^"]+)"/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const url = match[1]!
    if (/^https?:\/\//i.test(url) || url.startsWith('//')) urls.add(url)
  }
  return [...urls].slice(0, 40)
}

/** Injects the app's base typography into email HTML for consistent rendering. */
export function wrapEmailHtml(body: string, options: { dark: boolean; textScale: number; accent: string }): string {
  const { dark, textScale, accent } = options
  const fg = dark ? '#dfe6ec' : '#26313a'
  const muted = dark ? '#9fb0bd' : '#5c6b78'
  const link = dark ? '#8fc4d1' : '#2f6f7e'
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src novamail-att: data: https: http:; style-src 'unsafe-inline'; font-src data:;">
<style>
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: ${(15.5 * textScale).toFixed(1)}px;
    line-height: 1.62;
    color: ${fg};
    background: transparent;
    padding: 4px 2px 24px;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  img { max-width: 100%; height: auto; }
  .nm-blocked-image { min-width: 24px; min-height: 24px; }
  a { color: ${link}; }
  table { max-width: 100%; }
  blockquote {
    margin: 12px 0; padding: 8px 14px; border-left: 3px solid ${accent}55; color: ${muted};
  }
  pre { white-space: pre-wrap; background: ${dark ? '#1a222b' : '#f1f4f7'}; padding: 12px; border-radius: 10px; overflow-x: auto; }
  hr { border: none; border-top: 1px solid ${dark ? '#2b3540' : '#e2e8ee'}; margin: 18px 0; }
</style></head><body>${body}</body></html>`
}
