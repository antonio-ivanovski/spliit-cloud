import type { RegisterSWOptions } from 'vite-plugin-pwa/types'

export function registerSW(options: RegisterSWOptions = {}) {
  options.onRegisteredSW?.('/sw.js', undefined)
  return async () => {}
}
