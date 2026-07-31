/**
 * Resolve the browser-visible API origin.
 *
 * Docker deployments use the current origin and let the web container proxy API
 * routes internally. Separately hosted web deployments (Cloudflare Pages, for
 * example) can still bake a distinct public API origin into the SPA with
 * VITE_API_URL.
 */
export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL?.replace(/\/+$/, '')
  if (configured) return configured
  return typeof window === 'undefined'
    ? 'http://localhost:3001'
    : window.location.origin
}
