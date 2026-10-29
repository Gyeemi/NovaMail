/**
 * Novamail - redaction helpers.
 *
 * Security requirement: passwords, tokens, message bodies and attachment
 * contents must never reach the log files, crash reports or diagnostics.
 */

const SECRET_KEY_PATTERN =
  /(pass(word|wd)?|secret|token|authorization|cookie|apikey|api_key|refresh_token|access_token|client_secret|credential|session)/i

const MAX_STRING = 400

/** Redacts values of secret-looking keys in a plain object (recursively). */
export function redact<T>(value: T, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message) }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  return '[unserialisable]'
}

export function truncate(text: string, max = MAX_STRING): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}… [${text.length - max} chars omitted]`
}

/** Removes common inline secrets from free text (URLs with tokens, bearer headers). */
export function scrubText(text: string): string {
  return text
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/([?&](?:access_token|token|code|password|refresh_token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(Basic\s+)[A-Za-z0-9+/=]+/gi, '$1[redacted]')
}

/** Never log raw credential payloads. */
export function describeSecret(value: string | undefined | null): string {
  if (!value) return 'none'
  return `present(${value.length} chars)`
}
