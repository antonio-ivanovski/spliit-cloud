import {
  assertHandlersRegistered,
  env as jobsEnv,
  registerHandlers,
  scheduleReconciliation,
  startBoss,
  stopBoss,
  type SpliitBoss,
} from '@spliit/jobs'
import { handlers } from './handlers'

let inlineBoss: SpliitBoss | null = null

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ component: 'inline-worker', message, ...fields }),
  )

/**
 * Run the job worker inside the API process when JOBS_INLINE=true, so a small
 * deployment needs one always-on service instead of two. Behaviour is identical
 * to apps/worker; only the hosting shape differs.
 *
 * ponytail: this leaves the API's enqueue-only pg-boss client (getApiBoss) in
 * place, so an inline process holds two pools instead of sharing one. That is
 * ~2 extra connections; unify them if connection count ever becomes the
 * constraint.
 */
export async function startInlineWorker(): Promise<void> {
  if (!jobsEnv.JOBS_INLINE) return
  if (!jobsEnv.JOBS_ENABLED) {
    log('jobs disabled; inline worker not started')
    return
  }
  if (inlineBoss) return

  const boss = await startBoss()
  assertHandlersRegistered(handlers)
  await registerHandlers(boss, handlers)
  await scheduleReconciliation(boss)
  inlineBoss = boss
  log('inline worker started', { cron: jobsEnv.JOBS_RECONCILIATION_CRON })
}

export async function stopInlineWorker(): Promise<void> {
  const boss = inlineBoss
  inlineBoss = null
  if (!boss) return
  await stopBoss(boss)
  log('inline worker stopped')
}
