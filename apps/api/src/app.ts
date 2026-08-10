import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider'
import { Scalar } from '@scalar/hono-api-reference'
import { TRPCError } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { auth } from './lib/auth'
import { env, webOrigins } from './lib/env'
import { checkLiveness, checkReadiness } from './lib/health'
import { logServerError, logServerWarn } from './lib/logging'
import { FixedWindowLimiter, resolveClientIp } from './lib/rate-limit'
import { buildScalarConfig } from './lib/scalar-theme'
import {
  emailUnsubscribeGet,
  emailUnsubscribePost,
} from './routes/email-unsubscribe'
import { exportGroupCsv } from './routes/export-csv'
import { exportGroupJson } from './routes/export-json'
import { proxyImportDocument } from './routes/import-document'
import { reportGroupData } from './routes/report-data'
import { createTRPCContext } from './trpc/init'
import { appRouter } from './trpc/routers/_app'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Resolve the generated OpenAPI spec relative to the compiled/running
// file so it works for both `bun run src/server.ts` (dev) and a future
// bundled deployment.
const openapiSpecPath = resolve(__dirname, '..', 'openapi.json')

export const app = new Hono()

function isPublicOAuthProtocolPath(path: string) {
  return (
    path.startsWith('/.well-known/') ||
    path === '/auth/jwks' ||
    path.startsWith('/auth/oauth2/')
  )
}

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
    origin: (origin, c) => {
      if (!origin) return origin
      // OAuth public clients such as MCP Inspector can run at origins that
      // are unknown at deployment time. These protocol endpoints are
      // independently protected by PKCE, client validation and bearer
      // credentials; reflecting the requesting origin only enables the
      // browser transport. Normal Spliit APIs remain restricted below.
      if (isPublicOAuthProtocolPath(c.req.path)) return origin
      return webOrigins.includes(origin) ? origin : ''
    },
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'trpc-accept',
      'x-import-document-token',
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
)

app.get('/health', () => checkLiveness())
app.get('/health/liveness', () => checkLiveness())
app.get('/health/readiness', () => checkReadiness())

const oauthRegistrationLimiter = new FixedWindowLimiter({
  limit: 20,
  windowMs: 60 * 60 * 1000,
})
app.use('/auth/oauth2/register', async (c, next) => {
  const ip = resolveClientIp(c.req.raw.headers, {
    trustProxy: env.TRUST_PROXY,
  })
  const decision = oauthRegistrationLimiter.hit(ip)
  if (!decision.allowed) {
    return c.json(
      { error: 'rate_limit_exceeded' },
      {
        status: 429,
        headers: { 'Retry-After': String(decision.retryAfterSeconds) },
      },
    )
  }
  await next()
})

// Public, stateless optional-email unsubscribe endpoint. GET only renders a
// confirmation page; POST performs the RFC 8058 one-click mutation.
app.get('/email/unsubscribe', emailUnsubscribeGet)
app.post('/email/unsubscribe', emailUnsubscribePost)

// better-auth handler — exposes /auth/sign-in, /auth/sign-up, etc.
app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
app.get('/.well-known/oauth-authorization-server', (c) =>
  env.ENABLE_MCP
    ? oauthProviderAuthServerMetadata(auth, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      })(c.req.raw)
    : c.notFound(),
)
app.get('/.well-known/oauth-authorization-server/auth', (c) =>
  env.ENABLE_MCP
    ? oauthProviderAuthServerMetadata(auth, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      })(c.req.raw)
    : c.notFound(),
)
app.get('/.well-known/openid-configuration', (c) =>
  env.ENABLE_MCP
    ? oauthProviderOpenIdConfigMetadata(auth, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      })(c.req.raw)
    : c.notFound(),
)
app.get('/.well-known/openid-configuration/auth', (c) =>
  env.ENABLE_MCP
    ? oauthProviderOpenIdConfigMetadata(auth, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      })(c.req.raw)
    : c.notFound(),
)

app.get('/groups/:groupId/expenses/export/json', (c) =>
  exportGroupJson(c.req.raw, c.req.param('groupId')),
)
app.get('/groups/:groupId/expenses/export/csv', (c) =>
  exportGroupCsv(c.req.raw, c.req.param('groupId')),
)
app.post('/imports/documents/file', (c) => proxyImportDocument(c.req.raw))
app.post('/groups/:groupId/expenses/report-data', (c) =>
  reportGroupData(c.req.raw, c.req.param('groupId')),
)

// Public OpenAPI spec served at /openapi.json. The file is generated by
// `bun generate-openapi` (Turbo task `generate-openapi`); if it's missing
// the route 404s with a clear hint instead of crashing the server.
app.get('/openapi.json', async (c) => {
  try {
    const body = await readFile(openapiSpecPath, 'utf8')
    return c.json(JSON.parse(body))
  } catch (err) {
    logServerWarn('api.openapi', err, { path: '/openapi.json' })
    return c.json(
      {
        error:
          'OpenAPI spec not generated. Run `bun generate-openapi` (or `bun run generate-openapi` in apps/api) to produce apps/api/openapi.json.',
      },
      404,
    )
  }
})

// Scalar-hosted API reference at /docs, fed from the same spec. The
// browser fetches /openapi.json itself, so we don't need to inline the
// document here. Brand theming (favicon, accent color, dark mode,
// disabled hosted Agent) lives in `lib/scalar-theme.ts`.
app.get(
  '/docs',
  Scalar({
    url: '/openapi.json',
    ...buildScalarConfig(),
  }),
)

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
