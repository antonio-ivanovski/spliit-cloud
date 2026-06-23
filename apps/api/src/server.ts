import { serve } from '@hono/node-server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env, webOrigins } from './lib/env'
import { checkLiveness, checkReadiness } from './lib/health'
import { exportGroupCsv } from './routes/export-csv'
import { exportGroupJson } from './routes/export-json'
import { createUploadUrl } from './routes/upload'
import { createTRPCContext } from './trpc/init'
import { appRouter } from './trpc/routers/_app'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return origin
      return webOrigins.includes(origin) ? origin : ''
    },
    allowHeaders: ['Content-Type', 'Authorization', 'trpc-accept'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
)

app.get('/health', () => checkLiveness())
app.get('/health/liveness', () => checkLiveness())
app.get('/health/readiness', () => checkReadiness())

app.post('/uploads/presign', async (c) => {
  const body = await c.req.json<{ fileName?: string; contentType?: string }>()
  return createUploadUrl(
    body.fileName ?? 'document',
    body.contentType ?? 'application/octet-stream',
  )
})

app.get('/groups/:groupId/expenses/export/json', (c) =>
  exportGroupJson(c.req.param('groupId')),
)
app.get('/groups/:groupId/expenses/export/csv', (c) =>
  exportGroupCsv(c.req.param('groupId')),
)

app.all('/trpc/*', (c) =>
  fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: createTRPCContext,
  }),
)

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`Spliit Cloud API listening on http://localhost:${info.port}`)
})
