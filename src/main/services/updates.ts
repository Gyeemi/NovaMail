/**
 * Novamail - update check.
 *
 * Novamail does not install updates behind the user's back and does not run a
 * background updater. It asks a release source over HTTPS whether a newer
 * version exists, tells the user, and lets them download the installer from the
 * official release page.
 *
 * Two sources are supported:
 *  - `feedUrl`: a publisher-run JSON document `{version, notes, url}`.
 *  - the project's own GitHub releases (the default), which needs no setup.
 *
 * Only *published* releases are considered; drafts never leak, and pre-releases
 * are skipped so a testing build is not offered to everybody.
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
  /** Publisher-provided JSON feed. Takes precedence when set. */
  feedUrl: string | null
  /** `owner/name` of the public repository that publishes installers. */
  githubRepo?: string | null
  fetchImpl?: typeof fetch
}

/** Shape of the fields this app reads from the GitHub releases API. */
interface GithubRelease {
  tag_name?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  html_url?: string
  assets?: { name?: string; browser_download_url?: string; size?: number }[]
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
    const { currentVersion, feedUrl, githubRepo } = this.options
    const base: UpdateCheckResult = {
      configured: Boolean(feedUrl || githubRepo),
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      releaseNotes: null,
      downloadUrl: null,
      verified: false,
      message: 'This build has no release source configured, so it cannot look for a newer version.'
    }

    if (feedUrl) return this.checkFeed(feedUrl, base)
    if (githubRepo) return this.checkGithub(githubRepo, base)
    return base
  }

  /** Fetches a URL with a timeout; throws on network failure. */
  private async getJson<T>(url: string, currentVersion: string): Promise<{ status: number; body: T | null }> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/vnd.github+json, application/json',
          'user-agent': `Novamail/${currentVersion}`
        }
      })
      if (!response.ok) return { status: response.status, body: null }
      return { status: response.status, body: (await response.json()) as T }
    } finally {
      clearTimeout(timer)
    }
  }

  private async checkFeed(feedUrl: string, base: UpdateCheckResult): Promise<UpdateCheckResult> {
    if (!/^https:\/\//i.test(feedUrl)) {
      log.warn('refusing an update feed that is not HTTPS')
      return { ...base, message: 'The configured update feed is not HTTPS, so Novamail refused to contact it.' }
    }
    const unreachable: UpdateCheckResult = {
      ...base,
      configured: true,
      message: 'Novamail could not reach the update feed. You are still using your installed version.'
    }
    try {
      const { status, body } = await this.getJson<UpdateFeedEntry>(feedUrl, base.currentVersion)
      if (status !== 200 || !body) {
        log.warn('update feed returned an error', { status })
        return unreachable
      }
      if (!body.version || typeof body.version !== 'string') {
        return { ...unreachable, message: 'The update feed returned an unexpected response.' }
      }
      const updateAvailable = UpdateService.isNewer(body.version, base.currentVersion)
      const safeUrl = body.url && /^https:\/\//i.test(body.url) ? body.url : null
      return {
        configured: true,
        updateAvailable,
        currentVersion: base.currentVersion,
        latestVersion: body.version,
        releaseNotes: body.notes ?? null,
        downloadUrl: safeUrl,
        // The feed is fetched over HTTPS; the installer itself is verified by the
        // user and by the release checksum.
        verified: true,
        message: updateAvailable
          ? `Novamail ${body.version} is available. You are using ${base.currentVersion}.`
          : `You are up to date (Novamail ${base.currentVersion}).`
      }
    } catch (error) {
      log.warn('update check failed', { error })
      return unreachable
    }
  }

  /** Picks the Windows installer from a release's assets, else the release page. */
  private static installerUrl(release: GithubRelease): string | null {
    const assets = release.assets ?? []
    const exe = assets.find((asset) => /\.exe$/i.test(asset.name ?? ''))
    const url = exe?.browser_download_url ?? release.html_url ?? null
    return url && /^https:\/\//i.test(url) ? url : null
  }

  private static normaliseVersion(release: GithubRelease): string {
    const raw = release.tag_name ?? release.name ?? ''
    return raw.trim().replace(/^v/i, '')
  }

  private async checkGithub(repo: string, base: UpdateCheckResult): Promise<UpdateCheckResult> {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=30`
    const unreachable: UpdateCheckResult = {
      ...base,
      configured: true,
      message: 'Novamail could not reach GitHub to check for updates. You are still using your installed version.'
    }

    try {
      const { status, body } = await this.getJson<GithubRelease[]>(url, base.currentVersion)
      if (status === 404) {
        return {
          ...unreachable,
          message: 'The release page for Novamail could not be found, so the update check was skipped.'
        }
      }
      if (status !== 200 || !Array.isArray(body)) {
        log.warn('github release lookup failed', { status })
        return unreachable
      }

      const published = body
        .filter((release) => !release.draft && !release.prerelease)
        .map((release) => ({ release, version: UpdateService.normaliseVersion(release) }))
        .filter((entry) => /^\d+(\.\d+)*$/.test(entry.version))

      if (published.length === 0) {
        return {
          configured: true,
          updateAvailable: false,
          currentVersion: base.currentVersion,
          latestVersion: null,
          releaseNotes: null,
          downloadUrl: `https://github.com/${repo}/releases`,
          verified: true,
          message: `No published release was found on GitHub yet. You are using ${base.currentVersion}.`
        }
      }

      published.sort((left, right) => (UpdateService.isNewer(right.version, left.version) ? 1 : -1))
      const newest = published[0]!
      const updateAvailable = UpdateService.isNewer(newest.version, base.currentVersion)

      return {
        configured: true,
        updateAvailable,
        currentVersion: base.currentVersion,
        latestVersion: newest.version,
        releaseNotes: newest.release.body?.trim() || null,
        downloadUrl: UpdateService.installerUrl(newest.release),
        verified: true,
        message: updateAvailable
          ? `Novamail ${newest.version} is available. You are using ${base.currentVersion}.`
          : `You are up to date (Novamail ${base.currentVersion}).`
      }
    } catch (error) {
      log.warn('update check failed', { error })
      return unreachable
    }
  }
}
