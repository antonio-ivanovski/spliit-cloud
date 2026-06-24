import { serve } from '@hono/node-server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './lib/auth'
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

// better-auth handler — exposes /api/auth/sign-in, /api/auth/sign-up, etc.
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.post('/uploads/presign', async (c) => {
  const body = await c.req.json<{
    ledgerId?: string
    fileName?: string
    contentType?: string
  }>()
  return createUploadUrl(
    c.req.raw,
    body.ledgerId,
    body.fileName ?? 'document',
    body.contentType ?? 'application/octet-stream',
  )
})

app.get('/groups/:groupId/expenses/export/json', (c) =>
  exportGroupJson(c.req.raw, c.req.param('groupId')),
)
app.get('/groups/:groupId/expenses/export/csv', (c) =>
  exportGroupCsv(c.req.raw, c.req.param('groupId')),
)

app.all('/trpc/*', (c) =>
  fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => createTRPCContext({ req: c.req.raw }),
  }),
)

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`Spliit Cloud API listening on http://localhost:${info.port}`)
})
