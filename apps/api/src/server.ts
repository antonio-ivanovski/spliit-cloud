import { app } from './app'
import { env } from './lib/env'

Bun.serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' })
console.log(`Spliit Cloud API listening on http://localhost:${env.PORT}`)
