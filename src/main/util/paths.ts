/**
 * Novamail - filesystem layout.
 *
 * All mutable user data lives OUTSIDE the installation directory so that
 * upgrades never overwrite accounts, settings or cached mail.
 *
 *   %APPDATA%\Novamail\            (Electron userData)
 *     novamail.db                  sqlite database (WAL)
 *     credentials.json             encrypted blobs (safeStorage / DPAPI)
 *     settings.json                non-secret UI settings cache
 *     logs\                        rotating structured logs
 *     cache\attachments\           attachment cache (auto-pruned)
 *     cache\previews\              generated preview artefacts (auto-pruned)
 *     backups\                     user initiated backups
 */
import path from 'node:path'

export interface AppPaths {
  root: string
  databaseFile: string
  credentialsFile: string
  settingsFile: string
  logsDir: string
  attachmentCacheDir: string
  previewCacheDir: string
  tempDir: string
  backupsDir: string
  draftsDir: string
}

export function resolveAppPaths(root: string): AppPaths {
  return {
    root,
    databaseFile: path.join(root, 'novamail.db'),
    credentialsFile: path.join(root, 'credentials.json'),
    settingsFile: path.join(root, 'settings.json'),
    logsDir: path.join(root, 'logs'),
    attachmentCacheDir: path.join(root, 'cache', 'attachments'),
    previewCacheDir: path.join(root, 'cache', 'previews'),
    tempDir: path.join(root, 'cache', 'temp'),
    backupsDir: path.join(root, 'backups'),
    draftsDir: path.join(root, 'cache', 'drafts')
  }
}
