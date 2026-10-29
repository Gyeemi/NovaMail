/**
 * Novamail - search service.
 *
 * Two stage search: the local SQLite FTS5 index answers instantly and works
 * offline; if results are thin and a connection is available, the same query is
 * sent to the IMAP server (SEARCH) and the hits are cached before the local
 * index is queried again.
 */
import type {
  Account,
  Folder,
  MessageListQuery,
  SavedSearch,
  SearchParams,
  SearchResponse,
  SearchSuggestion
} from '@shared/types'
import type { MessagesRepository } from '../db/repositories/messages'
import type { SearchHistoryRepository } from '../db/repositories/rules'
import type { AccountsRepository } from '../db/repositories/accounts'
import type { FoldersRepository } from '../db/repositories/folders'
import type { ContactsRepository } from '../db/repositories/productivity'
import type { SessionManager } from '../mail/sessions'
import { buildFtsMatch, parseSearchQuery } from './parse'
import { createLogger } from '../../util/logger'

const log = createLogger('search')

export interface SearchServiceDeps {
  messages: MessagesRepository
  history: SearchHistoryRepository
  accounts: AccountsRepository
  folders: FoldersRepository
  contacts: ContactsRepository
  sessions: SessionManager
}

const OPERATOR_HELP: SearchSuggestion[] = [
  { kind: 'operator', label: 'from:', value: 'from:', detail: 'sender address or name' },
  { kind: 'operator', label: 'to:', value: 'to:', detail: 'recipient' },
  { kind: 'operator', label: 'subject:', value: 'subject:', detail: 'words in the subject' },
  { kind: 'operator', label: 'has:attachment', value: 'has:attachment', detail: 'messages with files' },
  { kind: 'operator', label: 'is:unread', value: 'is:unread', detail: 'unread only' },
  { kind: 'operator', label: 'is:starred', value: 'is:starred', detail: 'starred only' },
  { kind: 'operator', label: 'after:', value: 'after:', detail: 'newer than a date (2024-03-01)' },
  { kind: 'operator', label: 'before:', value: 'before:', detail: 'older than a date' },
  { kind: 'operator', label: 'in:', value: 'in:', detail: 'archive, sent, trash...' },
  { kind: 'operator', label: 'filename:', value: 'filename:', detail: 'attachment file name' }
]

export class SearchService {
  constructor(private readonly deps: SearchServiceDeps) {}

  async run(params: SearchParams): Promise<SearchResponse> {
    const started = Date.now()
    const parsed = parseSearchQuery(params.q ?? '')
    const limit = Math.min(params.limit ?? 100, 300)
    const offset = params.offset ?? 0

    const accountId =
      params.accountId && params.accountId !== 'all'
        ? params.accountId
        : parsed.account
          ? (this.deps.accounts.findByEmail(parsed.account)?.id ?? 'all')
          : 'all'

    const query: MessageListQuery = {
      mailbox: params.mailbox ?? (parsed.mailbox ? mapMailboxName(parsed.mailbox) : 'all'),
      accountId,
      search: parsed.freeText || params.q ? stripOperators(params.q ?? '') : undefined,
      fromFilter: params.from ?? parsed.from[0],
      toFilter: params.to ?? parsed.to[0],
      subjectFilter: params.subject ?? parsed.subject[0],
      filenameFilter: parsed.filename,
      minSize: parsed.largerThan,
      attachmentsOnly: params.hasAttachment ?? parsed.hasAttachment,
      unreadOnly: params.unreadOnly ?? parsed.unreadOnly,
      starredOnly: params.starredOnly ?? parsed.starredOnly,
      label: parsed.label,
      fromDate: params.afterDate ?? parsed.after,
      toDate: params.beforeDate ?? parsed.before,
      includeSnoozed: true,
      includeDeleted: true,
      limit,
      offset,
      sort: 'date',
      direction: 'desc'
    } as MessageListQuery

    if (!query.search && !query.fromFilter && !query.subjectFilter && !query.toFilter && params.q?.trim()) {
      query.search = stripOperators(params.q)
    }

    let result = this.deps.messages.list(query)
    let usedServerSearch = false

    if (result.total < 5 && (query.search ?? '').length >= 3) {
      const fetched = await this.serverSearch(accountId, query.search ?? '')
      if (fetched > 0) {
        usedServerSearch = true
        result = this.deps.messages.list(query)
      }
    }

    if (params.q && params.q.trim().length >= 2) this.deps.history.recordSearch(params.q.trim())

    return {
      items: result.items,
      total: result.total,
      tookMs: Date.now() - started,
      usedServerSearch,
      operatorErrors: parsed.errors
    }
  }

  /** Runs IMAP SEARCH on the most relevant folders and caches the hits. */
  private async serverSearch(accountId: string, text: string): Promise<number> {
    const accounts = accountId === 'all' ? this.deps.accounts.list() : [this.deps.accounts.get(accountId)].filter(Boolean)
    let inserted = 0
    for (const account of accounts as Account[]) {
      const folders = this.deps.folders.list(account.id).filter((folder) => folder.kind !== 'outbox')
      for (const folder of folders.slice(0, 6)) {
        try {
          const uids = await this.deps.sessions.withSession(account.id, async (session) => {
            const hits = await session.search(folder.path, { text, subject: text })
            return hits
          })
          if (uids.length === 0) continue
          await this.deps.sessions.withSession(account.id, async (session) => {
            const slice = uids.slice(0, 40)
            const envelopes = await session.fetchHeaders(folder.path, { limit: 40 })
            const wanted = new Set(slice)
            for (const envelope of envelopes) {
              if (!wanted.has(envelope.uid)) continue
              this.deps.messages.upsert({
                accountId: account.id,
                folderId: folder.id,
                uid: envelope.uid,
                messageId: envelope.messageId,
                subject: envelope.subject,
                from: envelope.from,
                to: envelope.to,
                cc: envelope.cc,
                replyTo: envelope.replyTo,
                date: envelope.date,
                size: envelope.size,
                snippet: envelope.subject,
                isRead: envelope.flags.includes('\\Seen'),
                isStarred: envelope.flags.includes('\\Flagged'),
                hasAttachments: envelope.hasAttachments,
                attachmentCount: envelope.attachmentCount,
                headers: envelope.headers,
                references: envelope.headers['references']?.split(/\s+/).filter(Boolean) ?? [],
                inReplyTo: envelope.headers['in-reply-to'] ?? null
              })
              inserted += 1
            }
          })
        } catch (error) {
          log.debug('server search skipped a folder', { folder: folder.path, error })
        }
      }
    }
    if (inserted > 0) log.info('server search cached new hits', { inserted })
    return inserted
  }

  async suggestions(term: string): Promise<SearchSuggestion[]> {
    const trimmed = term.trim()
    const suggestions: SearchSuggestion[] = []

    if (!trimmed) {
      for (const query of this.deps.history.recentSearches(5)) {
        suggestions.push({ kind: 'recent', label: query, value: query })
      }
      suggestions.push(...OPERATOR_HELP.slice(0, 4))
      return suggestions
    }

    const lower = trimmed.toLowerCase()
    const operatorFragment = /(\w+):([^ ]*)$/.exec(trimmed)
    if (operatorFragment) {
      const [, op, partial] = operatorFragment
      const base = OPERATOR_HELP.filter((entry) => entry.value.startsWith(`${op}:`))
      if (op === 'from' || op === 'to') {
        const contacts = this.deps.contacts.suggest(partial ?? '', 5)
        for (const contact of contacts) {
          suggestions.push({
            kind: 'contact',
            label: `${contact.displayName} <${contact.emails[0] ?? ''}>`,
            value: `${op}:${contact.emails[0] ?? ''}`,
            detail: contact.source
          })
        }
      }
      if (op === 'in' || op === 'folder') {
        for (const folder of this.deps.folders.list().slice(0, 12)) {
          if (partial && !folder.name.toLowerCase().includes(partial.toLowerCase())) continue
          suggestions.push({ kind: 'folder', label: folder.name, value: `${op}:${folder.path}` })
        }
      }
      suggestions.push(...base)
      return suggestions.slice(0, 10)
    }

    for (const saved of this.deps.history.savedSearches().slice(0, 3)) {
      if (saved.name.toLowerCase().includes(lower)) {
        suggestions.push({ kind: 'saved', label: saved.name, value: saved.query, detail: 'saved search' })
      }
    }
    for (const contact of this.deps.contacts.suggest(trimmed, 4)) {
      suggestions.push({
        kind: 'contact',
        label: `${contact.displayName}`,
        value: `from:${contact.emails[0] ?? ''}`,
        detail: 'search messages from this contact'
      })
    }
    for (const recent of this.deps.history.recentSearches(5)) {
      if (recent.toLowerCase().includes(lower)) suggestions.push({ kind: 'recent', label: recent, value: recent })
    }
    suggestions.push(...OPERATOR_HELP.filter((entry) => entry.label.includes(lower)).slice(0, 4))
    suggestions.push({ kind: 'text', label: `Search for “${trimmed}”`, value: trimmed })
    return suggestions.slice(0, 10)
  }

  saved(): SavedSearch[] {
    return this.deps.history.savedSearches()
  }

  save(name: string, query: string): SavedSearch {
    return this.deps.history.saveSearch(name, query)
  }

  removeSaved(id: string): void {
    this.deps.history.removeSaved(id)
  }

  recent(): string[] {
    return this.deps.history.recentSearches(10)
  }

  clearRecent(): void {
    this.deps.history.clearRecent()
  }
}

/** Maps friendly mailbox names from `in:` / `folder:` operators to mailbox keys. */
export function mapMailboxName(value: string): string {
  const normalized = value.toLowerCase().trim()
  const known = ['inbox', 'archive', 'sent', 'drafts', 'trash', 'spam', 'starred', 'snoozed', 'all']
  if (known.includes(normalized)) return normalized
  if (normalized === 'junk') return 'spam'
  if (normalized === 'deleted' || normalized === 'bin') return 'trash'
  return 'all'
}

/** Removes operator tokens so the FTS query only contains free text. */
export function stripOperators(input: string): string {
  return input
    .replace(/\b(from|to|cc|subject|body|has|is|after|before|on|account|in|folder|label|larger|filename):("[^"]*"|\S+)/gi, ' ')
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildSearchQuery(params: SearchParams): MessageListQuery {
  const parsed = parseSearchQuery(params.q ?? '')
  return {
    mailbox: 'all',
    accountId: params.accountId ?? 'all',
    search: buildFtsMatch(stripOperators(params.q ?? '')) ?? undefined,
    fromFilter: parsed.from[0],
    subjectFilter: parsed.subject[0],
    attachmentsOnly: parsed.hasAttachment,
    unreadOnly: parsed.unreadOnly,
    starredOnly: parsed.starredOnly,
    includeDeleted: true,
    includeSnoozed: true,
    limit: params.limit ?? 100,
    offset: params.offset ?? 0
  } as MessageListQuery
}

export type { Folder }
