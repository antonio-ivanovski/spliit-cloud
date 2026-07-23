import { startApiBoss, stopBoss } from '@spliit/jobs'

let apiBossPromise: ReturnType<typeof startApiBoss> | null = null
export async function getApiBoss() {
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

/** Stop the API-side enqueue client during graceful server shutdown/tests. */
export async function stopApiBoss(): Promise<void> {
  const pending = apiBossPromise
  apiBossPromise = null
  if (!pending) return
  const boss = await pending.catch(() => null)
  if (boss) await stopBoss(boss)
}
