import { TRPCError } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './lib/auth'
import { webOrigins } from './lib/env'
import { checkLiveness, checkReadiness } from './lib/health'
import { logServerError, logServerWarn } from './lib/logging'
import { postCurrencyRates } from './routes/currency-rates'
import { exportGroupCsv } from './routes/export-csv'
import { exportGroupJson } from './routes/export-json'
import { createProfileImageUploadUrl, createUploadUrl } from './routes/upload'
import { createTRPCContext } from './trpc/init'
import { appRouter } from './trpc/routers/_app'

export const app = new Hono()

// Centralised handler for any uncaught error outside `/trpc/*`. tRPC has its
// own error pipeline (see `onError` on fetchRequestHandler below) so this
// only fires for non-tRPC routes — auth, uploads, exports, currency, health.
app.onError((err, c) => {
  const path = c.req.path
  // Health probes are polled constantly; surface only unexpected failures
  // through the centralised log to avoid noise. The health handler itself
  // already returns a structured payload with its own error info.
  if (path.startsWith('/health')) {
    logServerWarn('api.health', err, { method: c.req.method, path })
    return c.json({ status: 'error' }, 500)
  }
  logServerError('api', err, { method: c.req.method, path })
  return c.json({ status: 'error' }, 500)
})

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

// better-auth handler — exposes /auth/sign-in, /auth/sign-up, etc.
app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))

app.post('/uploads/presign', async (c) => {
  const body = await c.req.json<{
    ledgerId?: string
    fileName?: string
    contentType?: string
    fileSize?: number
  }>()
  return createUploadUrl(
    c.req.raw,
    body.ledgerId,
    body.fileName ?? 'document',
    body.contentType ?? 'application/octet-stream',
    body.fileSize,
  )
})

app.post('/uploads/profile-image/presign', async (c) => {
  const body = await c.req.json<{ fileSize?: number }>()
  return createProfileImageUploadUrl(c.req.raw, body.fileSize)
})

app.get('/groups/:groupId/expenses/export/json', (c) =>
  exportGroupJson(c.req.raw, c.req.param('groupId')),
)
app.get('/groups/:groupId/expenses/export/csv', (c) =>
  exportGroupCsv(c.req.raw, c.req.param('groupId')),
)

// Bulk FX lookup. POST so a 500-item batch doesn't blow the URL length
// limit (HTTP 431).
app.post('/currency/rates', (c) => postCurrencyRates(c.req.raw))

app.all('/trpc/*', (c) =>
  fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => createTRPCContext({ req: c.req.raw }),
    onError({ error, path, type, ctx }) {
      // Expected client errors are normal product behavior — logging them
      // would flood the console. Only log infrastructure failures (uncaught
      // exceptions turned into INTERNAL_SERVER_ERROR) and upstream-provider
      // failures (BAD_GATEWAY), plus any non-TRPCError that escaped a
      // procedure.
      const code = error.code
      const isExpected =
        error instanceof TRPCError &&
        (code === 'UNAUTHORIZED' ||
          code === 'FORBIDDEN' ||
          code === 'NOT_FOUND' ||
          code === 'BAD_REQUEST' ||
          code === 'PRECONDITION_FAILED' ||
          code === 'CONFLICT' ||
          code === 'TOO_MANY_REQUESTS')
      if (isExpected) return

      const accountId = ctx?.auth?.user?.id
      logServerError(
        'trpc',
        error,
        accountId ? { path, type, code, accountId } : { path, type, code },
      )
    },
  }),
)
