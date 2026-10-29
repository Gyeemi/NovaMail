import { randomUUID, randomBytes } from 'node:crypto'

export const newId = (): string => randomUUID()

export const nowIso = (): string => new Date().toISOString()

export const randomToken = (bytes = 32): string =>
  randomBytes(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** base64url encode / sha256 helpers shared by OAuth (PKCE) */
export function base64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Deterministic-ish thread key from headers. */
export function threadKeyFor(messageId: string | null, references: string[], subject: string): string {
  const root = references.length > 0 ? references[0]! : messageId
  if (root) return root
  const normalized = subject
    .replace(/^((re|fw|fwd|aw|sv|vs)\s*:\s*)+/gi, '')
    .trim()
    .toLowerCase()
    .slice(0, 120)
  return `subject:${normalized}`
}
