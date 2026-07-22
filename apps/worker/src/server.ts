import { initializeDefaultNotificationDispatchers } from '@spliit/api/lib/notifications/dispatcher'
import { prisma } from '@spliit/db'
import {
  assertHandlersRegistered,
  env,
  registerHandlers,
  scheduleReconciliation,
  startBoss,
  stopBoss,
} from '@spliit/jobs'
import { createAdminFetch, createDisabledHealthFetch } from './admin'
import { handlers } from './handlers'

async function main() {
  if (!env.JOBS_ENABLED) {
    const health = Bun.serve({
      hostname: env.JOBS_ADMIN_HOST,
      port: env.JOBS_ADMIN_PORT,
      fetch: createDisabledHealthFetch,
    })
    console.log(
      JSON.stringify({
        component: 'worker',
        message: 'jobs disabled; health server started',
        port: health.port,
      }),
    )
    const stop = () => health.stop(true)
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    return
  }

  initializeDefaultNotificationDispatchers()
  const boss = await startBoss()
  assertHandlersRegistered(handlers)
  await registerHandlers(boss, handlers)
  await scheduleReconciliation(boss)

  const admin = Bun.serve({
    hostname: env.JOBS_ADMIN_HOST,
    port: env.JOBS_ADMIN_PORT,
    fetch: createAdminFetch(boss),
  })
  console.log(
    JSON.stringify({
      component: 'worker',
      message: 'worker started',
      port: admin.port,
    }),
  )

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(
      JSON.stringify({
        component: 'worker',
        message: 'worker stopping',
        signal,
      }),
    )
    admin.stop(true)
    await stopBoss(boss)
    await prisma.$disconnect()
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch(async (error) => {
  console.error(
    JSON.stringify({
      component: 'worker',
      message: 'worker failed to start',
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  await prisma.$disconnect().catch(() => undefined)
  process.exitCode = 1
})
