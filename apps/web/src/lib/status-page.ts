/**
 * Resolve the public status-page URL, if the deployment configured one.
 *
 * Spliit Cloud builds set `VITE_STATUS_PAGE_URL=https://status.spliit.cloud/`.
 * Self-hosters can point it at their own status page — or leave it unset, in
 * which case server-down UI shows a retry action with no external link (linking
 * a self-hosted outage to Spliit's Cloud status page would be wrong).
 */
export function getStatusPageUrl(): string | null {
  const configured = import.meta.env.VITE_STATUS_PAGE_URL?.trim()
  if (!configured) return null
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url.toString()
}
