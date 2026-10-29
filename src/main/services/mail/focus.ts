/**
 * Novamail - Focused / Other inbox classification.
 *
 * This is a local heuristic (no message content leaves the machine):
 * bulk and machine-generated mail goes to "Other", human mail stays "Focused".
 */
const BULK_LOCAL_PARTS =
  /^(no-?reply|do-?not-?reply|notifications?|newsletter|news|mailer-daemon|postmaster|bounce[sd]?|marketing|promo(tions)?|offers?|updates?|support-noreply|info|hello|team|digest|alerts?)$/i

const BULK_SUBJECT = /\b(newsletter|unsubscribe|webinar|promotion|digest|subscription|receipt|automated)\b/i

const AUTOMATED_FROM = /\b(mailer-daemon|automated|auto-confirm|autoreply)\b/i

export interface FocusInput {
  fromAddress: string
  fromName: string
  subject: string
  headers: Record<string, string>
  toAddresses: string[]
  accountEmail: string
}

export function classifyFocus(input: FocusInput): 'focused' | 'other' {
  const { fromAddress, subject, headers, toAddresses, accountEmail } = input
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])
  )

  if (lowerHeaders['list-unsubscribe'] || lowerHeaders['list-id'] || lowerHeaders['list-post']) return 'other'
  if ((lowerHeaders['precedence'] ?? '').toLowerCase().includes('bulk')) return 'other'
  if ((lowerHeaders['auto-submitted'] ?? '').toLowerCase().includes('auto')) return 'other'
  if (/bulk/i.test(lowerHeaders['x-precedence'] ?? '')) return 'other'
  if (BULK_SUBJECT.test(subject)) return 'other'
  if (AUTOMATED_FROM.test(fromAddress)) return 'other'

  const localPart = (fromAddress.split('@')[0] ?? '').toLowerCase()
  if (BULK_LOCAL_PARTS.test(localPart)) {
    // A real person writing to you directly is still human mail.
    const addressedDirectly = toAddresses.some(
      (t) => t.toLowerCase() === accountEmail.toLowerCase() && !/\b(newsletter|unsubscribe)\b/i.test(subject)
    )
    if (!addressedDirectly) return 'other'
  }

  const recipientCount = toAddresses.filter((t) => t.includes('@')).length
  if (recipientCount > 12) return 'other'

  return 'focused'
}
