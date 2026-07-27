import {
  env as jobsEnv,
  startApiBoss,
  stopBoss,
  type SpliitBoss,
} from '@spliit/jobs'

let apiBossPromise: Promise<SpliitBoss> | null = null

export async function getApiBoss(): Promise<SpliitBoss | null> {
  if (!jobsEnv.JOBS_ENABLED) return null
  return getApiBossForWrite()
}

export async function getApiBossForWrite(): Promise<SpliitBoss> {
  if (!jobsEnv.JOBS_ENABLED) {
    throw new Error('Background jobs are disabled')
  }
  if (!apiBossPromise) {
    const pending = startApiBoss()
    const tracked = pending.catch((error) => {
      if (apiBossPromise === tracked) apiBossPromise = null
      throw error
    })
    apiBossPromise = tracked
  }
  return apiBossPromise
}

export async function stopApiBoss(): Promise<void> {
  const pending = apiBossPromise
  apiBossPromise = null
  if (!pending) return
  const boss = await pending.catch(() => null)
  if (boss) await stopBoss(boss)
}
