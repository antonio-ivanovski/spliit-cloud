import 'reflect-metadata'
import { prisma } from '@spliit/db'

import { app } from './app'
import { activateAnnouncementCampaigns } from './lib/announcements/activate'
import { stopApiBoss } from './lib/api/boss'
import { env } from './lib/env'
import { runShutdown } from './lib/lifecycle/shutdown'

const MAX_REQUEST_BODY_SIZE = 10 * 1024 * 1024

let stopping = false

async function shutdown(server: Bun.Server<unknown>, signal: string) {
  if (stopping) return
  stopping = true
  console.log(`Spliit Cloud API stopping (${signal})`)
  const result = await runShutdown({
    stopServer: () => server.stop(true),
    stopBoss: stopApiBoss,
  })
  if (!result.clean) process.exitCode = 1
}

async function main() {
  await activateAnnouncementCampaigns()
  const server = Bun.serve({
    fetch: app.fetch,
    port: env.PORT,
    hostname: '0.0.0.0',
    maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
  })
  console.log(`Spliit Cloud API listening on http://localhost:${env.PORT}`)
  process.once('SIGINT', () => void shutdown(server, 'SIGINT'))
  process.once('SIGTERM', () => void shutdown(server, 'SIGTERM'))
}

main().catch(async (error) => {
  console.error('Spliit Cloud API failed to start', error)
  await prisma.$disconnect().catch(() => undefined)
  process.exitCode = 1
})
