import { app } from './app'
import { stopApiBoss } from './lib/api/boss'
import { env } from './lib/env'
import { runShutdown } from './lib/lifecycle/shutdown'

const server = Bun.serve({
  fetch: app.fetch,
  port: env.PORT,
  hostname: '0.0.0.0',
})
console.log(`Spliit Cloud API listening on http://localhost:${env.PORT}`)

let stopping = false

async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.log(`Spliit Cloud API stopping (${signal})`)
  const result = await runShutdown({
    stopServer: () => server.stop(true),
    stopBoss: stopApiBoss,
  })
  if (!result.clean) process.exitCode = 1
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
