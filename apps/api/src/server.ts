import { serve } from '@hono/node-server'
import { app } from './app'
import { env } from './lib/env'

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`Spliit Cloud API listening on http://localhost:${info.port}`)
})
