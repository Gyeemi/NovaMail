/**
 * Novamail - automatic account configuration.
 *
 * 1. well known providers (Gmail, Microsoft 365, iCloud, Yahoo)
 * 2. the Thunderbird autoconfig standard (https://autoconfig.<domain>/mail/config-v1.1.xml
 *    and https://<domain>/.well-known/autoconfig/mail/config-v1.1.xml)
 * 3. conservative host name guesses, which the user can always override
 *
 * Nothing is assumed silently: the wizard always shows the result and lets the
 * user edit every field before saving.
 */
import type { AutoconfigResult } from '@shared/ipc'
import type { ProviderId, ServerConfig } from '@shared/types'
import { PROVIDERS, detectProviderByEmail } from '@shared/providers'
import { createLogger } from '../../util/logger'

const log = createLogger('autoconfig')

const AUTOCONFIG_URLS = (domain: string): string[] => [
  `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(`user@${domain}`)}`,
  `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
  `https://autoconfig.thunderbird.net/v1.1/${domain}`
]

interface AutoconfigServer {
  type: 'imap' | 'smtp' | string
  hostname: string
  port: string | number
  socketType: string
  username?: string
  authentication?: string
}

function parseAutoconfigXml(xml: string): AutoconfigServer[] {
  const servers: AutoconfigServer[] = []
  const blocks = xml.match(/<incomingServer[\s\S]*?<\/incomingServer>|<outgoingServer[\s\S]*?<\/outgoingServer>/gi) ?? []
  const blocks2 = blocks.length > 0 ? blocks : (xml.match(/<server[\s\S]*?<\/server>/gi) ?? [])
  for (const block of blocks2) {
    const type =
      /<incomingServer[^>]*type="([^"]+)"/i.exec(block)?.[1] ??
      /<outgoingServer[^>]*type="([^"]+)"/i.exec(block)?.[1] ??
      /<type>([^<]+)<\/type>/i.exec(block)?.[1] ??
      (block.toLowerCase().includes('smtp') ? 'smtp' : 'imap')
    const hostname =
      /<hostname>([^<]+)<\/hostname>/i.exec(block)?.[1] ?? /<hostName>([^<]+)<\/hostName>/i.exec(block)?.[1]
    const port = /<port>(\d+)<\/port>/i.exec(block)?.[1]
    const socketType =
      /<socketType>([^<]+)<\/socketType>/i.exec(block)?.[1] ??
      /<socketType>([^<]+)<\/socketType>/i.exec(block)?.[1] ??
      'SSL'
    const authentication = /<authentication>([^<]+)<\/authentication>/i.exec(block)?.[1]
    if (hostname && port) {
      servers.push({
        type: type.toLowerCase(),
        hostname: hostname.trim(),
        port,
        socketType: socketType.toUpperCase(),
        authentication
      })
    }
  }
  return servers
}

export function guessAutoconfig(email: string): AutoconfigResult {
  const domain = email.split('@')[1]?.toLowerCase().trim() ?? ''
  const known = detectProviderByEmail(email)
  if (known && known.imap && known.smtp) {
    return {
      providerId: known.id,
      authType: known.authType,
      imap: known.imap,
      smtp: known.smtp,
      notes: known.setupNotes,
      confident: true
    }
  }

  const base = domain.replace(/^www\./, '')
  return {
    providerId: 'generic' as ProviderId,
    authType: 'password' as const,
    imap: { host: `imap.${base}`, port: 993, secure: true } satisfies ServerConfig,
    smtp: { host: `smtp.${base}`, port: 587, secure: false } satisfies ServerConfig,
    notes: [
      'These server names are an educated guess. Check them with your mail provider before saving.',
      'Common ports: IMAP 993 with SSL/TLS, SMTP 587 with STARTTLS or 465 with SSL/TLS.'
    ],
    confident: false
  }
}

export async function discoverAutoconfig(
  email: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6000
): Promise<AutoconfigResult> {
  const guess = guessAutoconfig(email)
  if (guess.confident) return guess

  const domain = email.split('@')[1]?.toLowerCase().trim()
  const base = guess
  if (!domain) return base

  for (const url of AUTOCONFIG_URLS(domain)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/xml,text/xml,*/*', 'user-agent': 'Novamail/1.0' }
      })
      if (!response.ok) continue
      const xml = await response.text()
      const servers = parseAutoconfigXml(xml)
      const imap = servers.find((server) => server.type.includes('imap'))
      const smtp = servers.find((server) => server.type.includes('smtp'))
      if (!imap || !smtp) continue
      return {
        providerId: 'generic',
        authType: 'password',
        imap: {
          host: imap.hostname,
          port: Number(imap.port) || 993,
          secure: /SSL|TLS/i.test(imap.socketType)
        },
        smtp: {
          host: smtp.hostname,
          port: Number(smtp.port) || 587,
          secure: /SSL/i.test(smtp.socketType)
        },
        notes: [
          'Settings were discovered automatically from your provider.',
          'Review them once, then Novamail will test the connection before saving.'
        ],
        confident: true
      }
    } catch (error) {
      log.debug('autoconfig lookup failed', { url, error })
    } finally {
      clearTimeout(timer)
    }
  }

  return base
}

export function providerInfoFor(id: ProviderId) {
  return PROVIDERS[id]
}
