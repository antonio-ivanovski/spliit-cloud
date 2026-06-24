import { env } from '../env'

export function getApiBaseUrl(): string {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL
  // In local dev the API runs on 3001 and the web on 3000. Use the configured
  // port to derive a sensible base URL when no explicit override is set.
  return `http://localhost:${env.PORT}`
}

export function getWebBaseUrl(): string {
  const firstWebOrigin = env.WEB_ORIGINS.split(',')
    .map((o) => o.trim())
    .find(Boolean)
  return firstWebOrigin ?? 'http://localhost:3000'
}
