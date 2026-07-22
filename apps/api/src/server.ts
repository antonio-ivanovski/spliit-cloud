import { app } from './app'
import { stopApiBoss } from './lib/api/recurrence-series'
import { env } from './lib/env'
import { initializeDefaultNotificationDispatchers } from './lib/notifications/dispatcher'

initializeDefaultNotificationDispatchers()

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
  await stopApiBoss().catch((error) => {
    console.error('Failed to stop API job client', error)
  })
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
