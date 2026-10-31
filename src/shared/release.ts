/**
 * Novamail - release identity.
 *
 * Where this build looks for a newer version. Kept in shared code so the About
 * page can name the same source the main process queries, and overridable so a
 * fork or an on-premises deployment does not check the upstream repository.
 */
export const RELEASES_REPO = 'Gyeemi/NovaMail'

/** Human-facing release page shown when no installer asset can be found. */
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`

/**
 * The repository the update check queries. `NOVAMAIL_RELEASES_REPO` wins when it
 * is set to a valid `owner/name` pair, which is how a private deployment points
 * the client at its own build pipeline.
 */
export function releaseRepoFromEnv(env: Record<string, string | undefined>): string {
  const override = env['NOVAMAIL_RELEASES_REPO']?.trim()
  if (override && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(override)) return override
  return RELEASES_REPO
}
