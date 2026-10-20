import { z } from 'zod'

export const pwaBuildSchema = z.object({
  buildId: z.string().min(1),
  version: z.string().min(1),
})

export type PwaBuild = z.infer<typeof pwaBuildSchema>

// The fallback is for tests and development, where no deployment is running.
export const PWA_BUILD: PwaBuild =
  typeof __APP_BUILD__ === 'undefined'
    ? { buildId: 'development', version: 'development' }
    : __APP_BUILD__

export const GET_PWA_BUILD = 'GET_PWA_BUILD'
