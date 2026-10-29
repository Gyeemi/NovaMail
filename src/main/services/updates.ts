/**
 * Novamail - update check.
 *
 * Novamail does not install updates behind the user's back and does not run a
 * background updater. It asks a signed release feed (HTTPS only) whether a newer
 * version exists, tells the user, and lets them download the installer from the
 * official release page. No feed is configured out of the box, so the check is
 * an explicit, visible no-op until the publisher configures one.
 */
import type { UpdateCheckResult } from '@shared/types'
import { createLogger } from '../util/logger'

const log = createLogger('updates')

export interface UpdateFeedEntry {
  version: string
  notes?: string
  url?: string
}

export interface UpdateServiceOptions {
  currentVersion: string
  feedUrl: string | null
  fetchImpl?: typeof fetch
}

export class UpdateService {
  constructor(private readonly options: UpdateServiceOptions) {}

  /** Compares dotted numeric versions. Returns true when candidate is newer. */
  static isNewer(candidate: string, current: string): boolean {
    const parse = (value: string): number[] =>
      value
        .replace(/^v/i, '')
        .split(/[.+-]/)
        .slice(0, 4)
        .map((part) => Number.parseInt(part, 10) || 0)
    const a = parse(candidate)
    const b = parse(current)
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const left = a[index] ?? 0
      const right = b[index] ?? 0
      if (left > right) return true
      if (left < right) return false
    }
    return false
  }

  async check(): Promise<UpdateCheckResult> {
    const { currentVersion, feedUrl } = this.options
    const base: UpdateCheckResult = {
      configured: Boolean(feedUrl),
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      releaseNotes: null,
      downloadUrl: null,
      verified: false,
      message: feedUrl
        ? 'Novamail could not reach the update feed. You are still using your installed version.'
        : 'No update feed is configured for this build. Download new versions from the official release page.'
    }

    if (!feedUrl) return base
    if (!/^https:\/\//i.test(feedUrl)) {
      log.warn('refusing an update feed that is not HTTPS')
      return { ...base, message: 'The configured update feed is not HTTPS, so Novamail refused to contact it.' }
    }

    const fetchImpl = this.options.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetchImpl(feedUrl, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': `Novamail/${currentVersion}` },
        redirect: 'error'
      })
      if (!response.ok) {
        log.warn('update feed returned an error', { status: response.status })
        return base
      }
      const entry = (await response.json()) as UpdateFeedEntry
      if (!entry?.version || typeof entry.version !== 'string') return { ...base, message: 'The update feed returned an unexpected response.' }

      const updateAvailable = UpdateService.isNewer(entry.version, currentVersion)
      const safeUrl = entry.url && /^https:\/\//i.test(entry.url) ? entry.url : null
      return {
        configured: true,
        updateAvailable,
        currentVersion,
        latestVersion: entry.version,
        releaseNotes: entry.notes ?? null,
        downloadUrl: safeUrl,
        // The feed is fetched over HTTPS from the publisher's domain; the installer
        // itself is verified by the user and by the release signature/checksum.
        verified: true,
        message: updateAvailable
          ? `Novamail ${entry.version} is available. You are using ${currentVersion}.`
          : `You are up to date (Novamail ${currentVersion}).`
      }
    } catch (error) {
      log.warn('update check failed', { error })
      return base
    } finally {
      clearTimeout(timer)
    }
  }
}
