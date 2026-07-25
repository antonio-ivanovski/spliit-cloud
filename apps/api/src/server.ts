import { app } from './app'
import { stopApiBoss } from './lib/api/recurrence-series'
import { env } from './lib/env'
import { startInlineWorker, stopInlineWorker } from './lib/jobs/inline'
import { initializeDefaultNotificationDispatchers } from './lib/notifications/dispatcher'

initializeDefaultNotificationDispatchers()

// No-op unless JOBS_INLINE=true. Not awaited: the API must start serving even
// if the job runner cannot reach the database.
void startInlineWorker().catch((error) => {
  console.error('Failed to start inline job worker', error)
})

const server = Bun.serve({
  fetch: app.fetch,
  port: env.PORT,
  hostname: '0.0.0.0',
})
console.log(`Spliit Cloud API listening on http://localhost:${env.PORT}`)

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Spliit Cloud API stopping (${signal})`)
  server.stop(true)
  await stopInlineWorker().catch((error) => {
    console.error('Failed to stop inline job worker', error)
  })
  await stopApiBoss().catch((error) => {
    console.error('Failed to stop API job client', error)
  })
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
