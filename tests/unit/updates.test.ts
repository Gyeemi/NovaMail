/**
 * Update-check tests.
 *
 * The GitHub path is the one that matters in the field: it is what a user sees
 * when they press "Check for updates". The fixtures mirror the real API payload
 * (see the live test at the bottom, which runs against api.github.com when the
 * sandbox has network access).
 */
import { describe, expect, it, vi } from 'vitest'
import { UpdateService } from '../../src/main/services/updates'
import { RELEASES_PAGE, releaseRepoFromEnv } from '@shared/release'

function service(fetchImpl: typeof fetch, extra: { feedUrl?: string | null; githubRepo?: string | null } = {}) {
  return new UpdateService({
    currentVersion: '1.0.0',
    feedUrl: extra.feedUrl ?? null,
    githubRepo: extra.githubRepo === undefined ? 'Gyeemi/NovaMail' : extra.githubRepo,
    fetchImpl
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `Novamail ${tag}`,
  body: `Changes in ${tag}`,
  draft: false,
  prerelease: false,
  html_url: `https://github.com/Gyeemi/NovaMail/releases/tag/${tag}`,
  assets: [
    {
      name: 'Novamail-Setup-x64.exe',
      browser_download_url: `https://github.com/Gyeemi/NovaMail/releases/download/${tag}/Novamail-Setup-x64.exe`,
      size: 141_000_000
    }
  ],
  ...extra
})

describe('version comparison', () => {
  it('orders dotted versions numerically, not lexically', () => {
    expect(UpdateService.isNewer('1.0.10', '1.0.9')).toBe(true)
    expect(UpdateService.isNewer('1.0.2', '1.0.10')).toBe(false)
    expect(UpdateService.isNewer('v1.1.0', '1.0.9')).toBe(true)
    expect(UpdateService.isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(UpdateService.isNewer('2', '1.9.9')).toBe(true)
  })
})

describe('GitHub release source (default)', () => {
  it('reports a newer published release with its installer asset', async () => {
    const fetchImpl = vi.fn(async () => json([release('v1.0.3'), release('v1.0.2'), release('v1.0.1')]))
    const result = await service(fetchImpl as unknown as typeof fetch).check()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const url = (fetchImpl.mock.calls[0] as unknown[])[0] as string
    expect(url).toBe('https://api.github.com/repos/Gyeemi/NovaMail/releases?per_page=30')

    expect(result.configured).toBe(true)
    expect(result.updateAvailable).toBe(true)
    expect(result.latestVersion).toBe('1.0.3')
    expect(result.currentVersion).toBe('1.0.0')
    expect(result.downloadUrl).toBe(
      'https://github.com/Gyeemi/NovaMail/releases/download/v1.0.3/Novamail-Setup-x64.exe'
    )
    expect(result.releaseNotes).toContain('Changes in v1.0.3')
    expect(result.message).toMatch(/1\.0\.3 is available/)
  })

  it('ignores drafts and pre-releases, which are not public downloads', async () => {
    const fetchImpl = async () =>
      json([
        release('v1.1.0', { draft: true }),
        release('v1.0.9', { prerelease: true }),
        release('v1.0.2')
      ])
    const result = await service(fetchImpl as unknown as typeof fetch).check()

    expect(result.latestVersion).toBe('1.0.2')
    expect(result.updateAvailable).toBe(true)
    expect(result.downloadUrl).toContain('/releases/download/v1.0.2/')
  })

  it('says it is up to date when the newest release is the installed one', async () => {
    const fetchImpl = async () => json([release('v1.0.0')])
    const result = await service(fetchImpl as unknown as typeof fetch).check()

    expect(result.updateAvailable).toBe(false)
    expect(result.message).toMatch(/up to date/i)
    expect(result.verified).toBe(true)
  })

  it('explains an empty release list instead of failing silently', async () => {
    const result = await service((async () => json([])) as unknown as typeof fetch).check()

    expect(result.configured).toBe(true)
    expect(result.updateAvailable).toBe(false)
    expect(result.message).toMatch(/No published release/i)
    expect(result.downloadUrl).toBe(RELEASES_PAGE)
  })

  it('reports an unreachable API without pretending the app is current-safe', async () => {
    const fetchImpl = async () => json({ message: 'rate limited' }, 403)
    const result = await service(fetchImpl as unknown as typeof fetch).check()

    expect(result.updateAvailable).toBe(false)
    expect(result.message).toMatch(/could not reach GitHub/i)
    expect(result.verified).toBe(false)
  })

  it('survives a network error', async () => {
    const fetchImpl = async () => {
      throw new Error('offline')
    }
    const result = await service(fetchImpl as unknown as typeof fetch).check()
    expect(result.message).toMatch(/could not reach GitHub/i)
  })

  it('falls back to the release page when a release has no installer asset', async () => {
    const fetchImpl = async () => json([release('v1.0.4', { assets: [] })])
    const result = await service(fetchImpl as unknown as typeof fetch).check()
    expect(result.downloadUrl).toBe('https://github.com/Gyeemi/NovaMail/releases/tag/v1.0.4')
  })
})

describe('publisher JSON feed', () => {
  it('is used when one is configured, and wins over GitHub', async () => {
    const fetchImpl = vi.fn(async () => json({ version: '1.2.0', notes: 'Big release', url: 'https://example.com/setup.exe' }))
    const result = await service(fetchImpl as unknown as typeof fetch, {
      feedUrl: 'https://updates.example.com/novamail.json'
    }).check()

    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('https://updates.example.com/novamail.json')
    expect(result.latestVersion).toBe('1.2.0')
    expect(result.downloadUrl).toBe('https://example.com/setup.exe')
  })

  it('refuses a feed that is not HTTPS', async () => {
    const fetchImpl = vi.fn()
    const result = await service(fetchImpl as unknown as typeof fetch, {
      feedUrl: 'http://updates.example.com/novamail.json'
    }).check()

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.message).toMatch(/not HTTPS/i)
  })

  it('ignores an insecure download link from an otherwise valid feed', async () => {
    const fetchImpl = async () => json({ version: '2.0.0', url: 'http://example.com/setup.exe' })
    const result = await service(fetchImpl as unknown as typeof fetch, {
      feedUrl: 'https://updates.example.com/novamail.json'
    }).check()
    expect(result.updateAvailable).toBe(true)
    expect(result.downloadUrl).toBeNull()
  })
})

describe('no source configured', () => {
  it('is explicit rather than silently doing nothing', async () => {
    const result = await new UpdateService({ currentVersion: '1.0.0', feedUrl: null, githubRepo: null }).check()
    expect(result.configured).toBe(false)
    expect(result.message).toMatch(/no release source/i)
  })
})

describe('release repository override', () => {
  it('defaults to the project and accepts an owner/name override', () => {
    expect(releaseRepoFromEnv({})).toBe('Gyeemi/NovaMail')
    expect(releaseRepoFromEnv({ NOVAMAIL_RELEASES_REPO: 'baraily/novamail-build' })).toBe('baraily/novamail-build')
    // Anything that is not a plain owner/name pair is ignored instead of being
    // interpolated into an API URL.
    expect(releaseRepoFromEnv({ NOVAMAIL_RELEASES_REPO: 'https://evil.example/x' })).toBe('Gyeemi/NovaMail')
    expect(releaseRepoFromEnv({ NOVAMAIL_RELEASES_REPO: 'a/b/c' })).toBe('Gyeemi/NovaMail')
  })
})

/**
 * Live check. Skipped automatically when the sandbox cannot reach GitHub, so a
 * normal offline `npm test` stays green.
 */
describe('live GitHub API', () => {
  it('parses the real releases payload for a repository that has published releases', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    let reachable = true
    try {
      const probe = await fetch('https://api.github.com/repos/electron/electron/releases?per_page=5', {
        signal: controller.signal,
        headers: { 'user-agent': 'Novamail-test' }
      })
      reachable = probe.ok
    } catch {
      reachable = false
    } finally {
      clearTimeout(timer)
    }
    if (!reachable) {
      console.warn('skipping live GitHub check: api.github.com is unreachable')
      return
    }

    const result = await new UpdateService({
      currentVersion: '0.0.1',
      feedUrl: null,
      githubRepo: 'electron/electron'
    }).check()

    expect(result.configured).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.updateAvailable).toBe(true)
    expect(result.latestVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(result.downloadUrl).toMatch(/^https:\/\/github\.com\/electron\/electron\/releases\//)
  }, 20_000)
})
