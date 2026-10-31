/**
 * Novamail - remote image loading with tracking protection.
 *
 * Remote images are blocked by default. When the user explicitly chooses
 * "Show images", the main process fetches them (never the renderer, which has no
 * direct network access) and hands back inline data URLs.
 *
 * Protections: only http(s), no loopback/private/link-local addresses (SSRF),
 * small size limit, short timeout, image content types only.
 */
import { extractRemoteImageUrls } from './sanitize'

export interface RemoteImageOptions {
  maxImages?: number
  maxBytesPerImage?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface RemoteImageResult {
  html: string
  loaded: number
  failed: number
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /^metadata\./i
]

export function isSafeRemoteUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname
  if (!host) return false
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) return false
  if (/^\d+$/.test(host)) return false
  if (/^\[/.test(host)) return false
  return true
}

export async function fetchRemoteImages(html: string, options: RemoteImageOptions = {}): Promise<RemoteImageResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxImages = options.maxImages ?? 30
  const maxBytes = options.maxBytesPerImage ?? 5 * 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 8000

  const urls = extractRemoteImageUrls(html).slice(0, maxImages)
  if (urls.length === 0) return { html, loaded: 0, failed: 0 }

  const replacements = new Map<string, string>()
  let failed = 0

  await Promise.all(
    urls.map(async (raw) => {
      if (!isSafeRemoteUrl(raw)) {
        failed += 1
        return
      }
      const url = raw.startsWith('//') ? `https:${raw}` : raw
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { accept: 'image/*', 'user-agent': 'Novamail/1.0' }
        })
        if (!response.ok) {
          failed += 1
          return
        }
        const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
        if (!contentType.startsWith('image/')) {
          failed += 1
          return
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length === 0 || buffer.length > maxBytes) {
          failed += 1
          return
        }
        replacements.set(raw, `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`)
      } catch {
        failed += 1
      } finally {
        clearTimeout(timer)
      }
    })
  )

  if (replacements.size === 0) return { html, loaded: 0, failed }

  const updated = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const match = /data-blocked-src="([^"]+)"/i.exec(tag)
    if (!match) return tag
    const dataUrl = replacements.get(match[1]!)
    if (!dataUrl) return tag
    return tag.replace(/src="[^"]*"/i, `src="${dataUrl}"`)
  })

  return { html: updated, loaded: replacements.size, failed }
}
