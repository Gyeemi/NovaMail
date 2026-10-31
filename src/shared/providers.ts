/**
 * Novamail - provider catalogue.
 *
 * Honest capability matrix: things that cannot be done over IMAP/SMTP with
 * good fidelity are marked as unsupported rather than faked.
 */
import type { ProviderCapabilities, ProviderId, ServerConfig } from './types'

export interface ProviderInfo {
  id: ProviderId
  label: string
  domains: string[]
  authType: 'oauth2' | 'password'
  oauthProvider: 'google' | 'microsoft' | null
  imap: ServerConfig | null
  smtp: ServerConfig | null
  capabilities: ProviderCapabilities
  /** shown in the account wizard */
  setupNotes: string[]
  docsUrl: string
  /** app-password guidance for password providers */
  appPasswordHelp: string | null
}

const baseCapabilities: ProviderCapabilities = {
  oauth: false,
  imap: true,
  smtp: true,
  calendar: 'none',
  contacts: 'none',
  serverSearch: true,
  idle: true,
  labels: false,
  snooze: true,
  readReceipts: false,
  deliveryReceipts: false,
  redirect: false
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gmail: {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    domains: ['gmail.com', 'googlemail.com'],
    authType: 'oauth2',
    oauthProvider: 'google',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 587, secure: false },
    capabilities: {
      ...baseCapabilities,
      oauth: true,
      calendar: 'google',
      contacts: 'google',
      labels: true,
      readReceipts: true
    },
    setupNotes: [
      'Novamail signs in through Google OAuth. Your Google password is never entered into Novamail.',
      'Gmail labels are synchronised as IMAP folders; Novamail shows them in the sidebar.',
      'Gmail moves deleted mail to "All Mail" and Trash according to your Gmail settings.'
    ],
    docsUrl: 'https://support.google.com/a/answer/9003945',
    appPasswordHelp: null
  },
  microsoft365: {
    id: 'microsoft365',
    label: 'Microsoft 365 (work or school)',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    authType: 'oauth2',
    oauthProvider: 'microsoft',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    capabilities: {
      ...baseCapabilities,
      oauth: true,
      calendar: 'microsoft',
      contacts: 'microsoft',
      readReceipts: true,
      deliveryReceipts: true
    },
    setupNotes: [
      'Novamail signs in through Microsoft OAuth 2.0 with PKCE. Novamail never sees your password.',
      'Your organisations administrator must allow the app registration (an application ID issued to you).',
      'Read and delivery receipts are requested, but the recipient client decides whether to honour them.'
    ],
    docsUrl: 'https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/portal/',
    appPasswordHelp: null
  },
  outlook: {
    id: 'outlook',
    label: 'Outlook.com',
    domains: ['outlook.com', 'hotmail.com', 'live.com'],
    authType: 'oauth2',
    oauthProvider: 'microsoft',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    capabilities: {
      ...baseCapabilities,
      oauth: true,
      calendar: 'microsoft',
      contacts: 'microsoft',
      readReceipts: true,
      deliveryReceipts: true
    },
    setupNotes: [
      'Novamail signs in through Microsoft OAuth 2.0 with PKCE. Your password is never entered into Novamail.',
      'Microsoft requires an application registration; see the Account Setup Guide in the documentation.'
    ],
    docsUrl: 'https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/portal/',
    appPasswordHelp: null
  },
  icloud: {
    id: 'icloud',
    label: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    authType: 'password',
    oauthProvider: null,
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    capabilities: { ...baseCapabilities, calendar: 'caldav', contacts: 'carddav' },
    setupNotes: [
      'iCloud does not offer OAuth to desktop mail clients, so Novamail uses an app-specific password.',
      'Create one at appleid.apple.com under Sign-In and Security > App-Specific Passwords.'
    ],
    docsUrl: 'https://support.apple.com/en-us/102525',
    appPasswordHelp: 'https://support.apple.com/en-us/102525'
  },
  yahoo: {
    id: 'yahoo',
    label: 'Yahoo Mail',
    domains: ['yahoo.com', 'ymail.com'],
    authType: 'password',
    oauthProvider: null,
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    capabilities: { ...baseCapabilities, calendar: 'caldav', contacts: 'carddav' },
    setupNotes: [
      'Yahoo requires an app password when two-step verification is enabled.',
      'Generate one in Yahoo Account Security > Generate app password.'
    ],
    docsUrl: 'https://help.yahoo.com/kb/generate-third-party-passwords-sln15241.html',
    appPasswordHelp: 'https://help.yahoo.com/kb/generate-third-party-passwords-sln15241.html'
  },
  generic: {
    id: 'generic',
    label: 'Other IMAP / SMTP provider',
    domains: [],
    authType: 'password',
    oauthProvider: null,
    imap: null,
    smtp: null,
    capabilities: { ...baseCapabilities },
    setupNotes: [
      'Ask your mail provider for the IMAP and SMTP server names, ports and encryption.',
      'Common settings: IMAP port 993 (SSL/TLS) and SMTP port 587 (STARTTLS) or 465 (SSL/TLS).',
      'Novamail validates the server certificate and refuses unencrypted connections by default.'
    ],
    docsUrl: 'https://www.rfc-editor.org/rfc/rfc9051',
    appPasswordHelp: null
  }
}

export const PROVIDER_LIST: ProviderInfo[] = Object.values(PROVIDERS)

export function detectProviderByEmail(email: string): ProviderInfo | null {
  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain) return null
  for (const provider of PROVIDER_LIST) {
    if (provider.domains.includes(domain)) return provider
  }
  return null
}

export const ACCOUNT_COLORS = [
  '#3f7d8c',
  '#5b7db1',
  '#7a6fb0',
  '#4e8c6a',
  '#b07a4e',
  '#a25f7a',
  '#6d7a86',
  '#8c6b3f'
]

export function isOAuthProvider(id: ProviderId): boolean {
  return PROVIDERS[id].authType === 'oauth2'
}
