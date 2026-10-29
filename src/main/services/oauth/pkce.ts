import { createHash, randomBytes } from 'node:crypto'
import { base64Url } from '../../util/ids'

export interface PkcePair {
  verifier: string
  challenge: string
  method: 'S256'
}

/** RFC 7636 S256 PKCE pair. 43-128 char verifier from 32 random bytes. */
export function createPkce(): PkcePair {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge, method: 'S256' }
}

export function createState(): string {
  return base64Url(randomBytes(24))
}

/** Decodes (without verifying) the JWT payload of an id_token. */
export function decodeIdToken(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}
