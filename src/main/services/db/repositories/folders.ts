/**
 * Novamail - folder repository.
 */
import type { Folder, FolderKind, Id } from '@shared/types'
import type { Db } from '../database'
import { newId } from '../../../util/ids'

interface FolderRow {
  id: string
  account_id: string
  path: string
  name: string
  delimiter: string
  kind: string
  parent_path: string | null
  unread_count: number
  total_count: number
}

const SYSTEM_MATCHERS: { kind: FolderKind; test: RegExp }[] = [
  { kind: 'inbox', test: /^(inbox|posteingang|boîte de réception)$/i },
  { kind: 'drafts', test: /^(drafts?|entwürfe|brouillons|\[gmail\]\/drafts)$/i },
  { kind: 'sent', test: /^(sent( items| mail)?|gesendet|éléments envoyés|\[gmail\]\/sent mail|sent items)$/i },
  { kind: 'archive', test: /^(archive|archiv|\[gmail\]\/all mail|all mail)$/i },
  { kind: 'spam', test: /^(spam|junk( e-mail)?|bulk mail|\[gmail\]\/spam)$/i },
  { kind: 'trash', test: /^(trash|deleted( items| messages)?|papierkorb|\[gmail\]\/trash)$/i },
  { kind: 'outbox', test: /^(outbox|postausgang)$/i }
]

export function classifyFolder(path: string): FolderKind {
  const leaf = path.split(/[./]/).pop() ?? path
  for (const matcher of SYSTEM_MATCHERS) {
    if (matcher.test.test(path) || matcher.test.test(leaf)) return matcher.kind
  }
  return 'folder'
}

export function mapFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    accountId: row.account_id,
    path: row.path,
    name: row.name,
    delimiter: row.delimiter,
    kind: row.kind as FolderKind,
    parentPath: row.parent_path,
    unreadCount: row.unread_count,
    totalCount: row.total_count,
    isVirtual: false
  }
}

export interface SyncFolderInput {
  path: string
  name: string
  delimiter: string
  parentPath: string | null
  kind: FolderKind
  uidValidity?: number | null
}

export class FoldersRepository {
  constructor(private readonly db: Db) {}

  list(accountId?: Id): Folder[] {
    const rows = accountId
      ? (this.db
          .prepare('SELECT * FROM folders WHERE account_id = ? ORDER BY kind, name')
          .all(accountId) as FolderRow[])
      : (this.db.prepare('SELECT * FROM folders ORDER BY account_id, kind, name').all() as FolderRow[])
    return rows.map(mapFolder)
  }

  get(id: Id): Folder | null {
    const row = this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined
    return row ? mapFolder(row) : null
  }

  findByPath(accountId: Id, path: string): Folder | null {
    const row = this.db
      .prepare('SELECT * FROM folders WHERE account_id = ? AND path = ?')
      .get(accountId, path) as FolderRow | undefined
    return row ? mapFolder(row) : null
  }

  findByKind(accountId: Id, kind: FolderKind): Folder | null {
    const row = this.db
      .prepare('SELECT * FROM folders WHERE account_id = ? AND kind = ? LIMIT 1')
      .get(accountId, kind) as FolderRow | undefined
    return row ? mapFolder(row) : null
  }

  getUidState(id: Id): { uidValidity: number | null; lastSeenUid: number } {
    const row = this.db.prepare('SELECT uid_validity, last_seen_uid FROM folders WHERE id = ?').get(id) as
      | { uid_validity: number | null; last_seen_uid: number }
      | undefined
    return { uidValidity: row?.uid_validity ?? null, lastSeenUid: row?.last_seen_uid ?? 0 }
  }

  setUidState(id: Id, uidValidity: number | null, lastSeenUid: number): void {
    this.db
      .prepare('UPDATE folders SET uid_validity = ?, last_seen_uid = ? WHERE id = ?')
      .run(uidValidity, lastSeenUid, id)
  }

  /** Upserts server folders, returns the folder records keyed by path. */
  syncServerFolders(accountId: Id, folders: SyncFolderInput[]): Map<string, Folder> {
    const upsert = this.db.prepare(
      `INSERT INTO folders (id, account_id, path, name, delimiter, kind, parent_path, uid_validity)
       VALUES (@id, @accountId, @path, @name, @delimiter, @kind, @parentPath, @uidValidity)
       ON CONFLICT(account_id, path) DO UPDATE SET
         name = excluded.name,
         delimiter = excluded.delimiter,
         kind = excluded.kind,
         parent_path = excluded.parent_path,
         uid_validity = coalesce(excluded.uid_validity, folders.uid_validity)`
    )
    const tx = this.db.transaction((items: SyncFolderInput[]) => {
      for (const folder of items) {
        upsert.run({
          id: newId(),
          accountId,
          path: folder.path,
          name: folder.name,
          delimiter: folder.delimiter,
          kind: folder.kind,
          parentPath: folder.parentPath,
          uidValidity: folder.uidValidity ?? null
        })
      }
    })
    tx(folders)
    const map = new Map<string, Folder>()
    for (const folder of this.list(accountId)) map.set(folder.path, folder)
    return map
  }

  createLocal(accountId: Id, path: string, name = path, delimiter = '/'): Folder {
    const kind = classifyFolder(path)
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO folders (id, account_id, path, name, delimiter, kind, parent_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, path) DO NOTHING`
      )
      .run(id, accountId, path, name, delimiter, kind, null)
    return this.findByPath(accountId, path)!
  }

  rename(id: Id, newPath: string): void {
    const name = newPath.split(/[./]/).pop() ?? newPath
    this.db
      .prepare('UPDATE folders SET path = ?, name = ?, kind = ? WHERE id = ?')
      .run(newPath, name, classifyFolder(newPath), id)
  }

  remove(id: Id): void {
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  }

  /** Recomputes unread/total counters used by the sidebar. */
  refreshCounts(accountId?: Id): void {
    const scope = accountId ? 'AND f.account_id = ?' : ''
    const params = accountId ? [accountId] : []
    this.db
      .prepare(
        `UPDATE folders SET
           unread_count = (SELECT COUNT(*) FROM messages m WHERE m.folder_id = folders.id AND m.is_read = 0 AND m.deleted_at IS NULL),
           total_count  = (SELECT COUNT(*) FROM messages m WHERE m.folder_id = folders.id AND m.deleted_at IS NULL)
         WHERE id IN (SELECT f.id FROM folders f WHERE 1=1 ${scope})`
      )
      .run(...params)
  }
}
