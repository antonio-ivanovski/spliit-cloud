/**
 * Build-time OpenAPI spec generator.
 *
 * Generates an OpenAPI 3.1 document for the Spliit API by combining:
 *
 * 1. Auto-generated spec from the tRPC router via `@trpc/openapi`. Zero
 *    per-procedure annotations are required — the generator introspects the
 *    router type and the Zod v4 inputs.
 * 2. Auto-generated auth paths from better-auth's `openAPI` plugin via
 *    `auth.api.generateOpenAPISchema()`. The plugin introspects every
 *    registered endpoint (core + magic-link) and emits accurate paths, request
 *    bodies, and responses — replacing hand-maintained auth paths that drifted
 *    from the real routes (e.g. magic-link is `/sign-in/magic-link`, not
 *    `/magic-link/generate`).
 * 3. Hand-maintained OpenAPI paths for the remaining REST endpoints (group
 *    bundle/CSV exports) that cannot move into tRPC.
 * 4. A `securitySchemes.session` cookie scheme + global `security` block so
 *    external consumers know how to authenticate, with `security: []` overrides
 *    on public procedures. Auth operations emitted by the better-auth plugin
 *    get their `bearerAuth` security remapped to `session` so the spec
 *    documents the real cookie name.
 * 5. Summary extraction: the first paragraph of each JSDoc-derived `description`
 *    becomes `summary`; the remaining paragraphs stay as `description` with the
 *    tRPC procedure footnote appended.
 * 6. A root `description` that explains the tRPC wire shape (dotted paths,
 *    envelope-wrapped responses, GET `?input=<json>` convention) because the
 *    auto-generated spec is tRPC-protocol-shaped rather than idiomatic REST.
 *
 * Output: `apps/api/openapi.json`. Served at `GET /openapi.json` and at Scalar
 * `/docs` from the running API server.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateOpenAPIDocument } from '@trpc/openapi'
import type { OpenAPIV3_1 } from 'openapi-types'

import { ASSISTANT_WRITE_SCOPE, SPLIIT_SCOPES } from '../src/lib/auth/scopes'
import {
  applyOAuthOperationContract,
  buildOAuthProtocolFallbackPaths,
} from '../src/lib/openapi/oauth-contract'
// When Docker builds without a DB (SKIP_AUTH_OPENAPI=1) better-auth 1.7's
// oauthProvider still fires a background OauthResource seed that surfaces as
// an unhandled P1001/DatabaseNotReachable rejection *after* the file is
// written. Swallow only that case so the build stays green; any other
// unhandled error still crashes.
if (process.env.SKIP_AUTH_OPENAPI === '1') {
  const isDbUnreachable = (err: unknown): boolean => {
    const msg =
      err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    return (
      msg.includes('P1001') ||
      msg.includes('DatabaseNotReachable') ||
      msg.includes("Can't reach database server")
    )
  }
  process.on('unhandledRejection', (reason: unknown) => {
    if (isDbUnreachable(reason)) {
      console.warn(
        `[openapi] suppressed unhandled DB rejection (SKIP_AUTH_OPENAPI=1): ${String(reason).slice(0, 600)}`,
      )
      return
    }
    console.error('Unhandled rejection in openapi generator:', reason)
    process.exit(1)
  })
  process.on('uncaughtException', (err: unknown) => {
    if (isDbUnreachable(err)) {
      const m = err instanceof Error ? err.message : String(err)
      console.warn(
        `[openapi] suppressed uncaught DB exception (SKIP_AUTH_OPENAPI=1): ${m.slice(0, 600)}`,
      )
      return
    }
    console.error('Uncaught exception in openapi generator:', err)
    process.exit(1)
  })
}

// Lazy import auth only when needed — avoids pulling @spliit/db + better-auth at
// build time in Docker where there's no DB. better-auth 1.7's oauthProvider
// races a second OauthResource query that leaks as an unhandled rejection.

const __dirname = dirname(fileURLToPath(import.meta.url))
const apiRoot = resolve(__dirname, '..')
const routerPath = resolve(apiRoot, 'src/trpc/routers/_app.ts')
const outputPath = resolve(apiRoot, 'openapi.json')

// Human-readable blurb per scope, shown in the Scalar security panel.
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'Identify the account (OpenID Connect).',
  profile: 'Read the account name and avatar.',
  email: 'Read the account email address.',
  offline_access: 'Obtain a refresh token so the client can keep working.',
  [SPLIIT_SCOPES.groupsRead]: 'Read groups, balances, statistics and activity.',
  [SPLIIT_SCOPES.groupsManage]:
    'Read, create and edit groups, and add participants.',
  [SPLIIT_SCOPES.groupsDelete]:
    'Read, delete or archive a group, and remove participants. Never granted by default.',
  [SPLIIT_SCOPES.expensesRead]: 'Read expenses and recurring series.',
  [SPLIIT_SCOPES.expensesManage]:
    'Read, create and edit expenses directly, and stop a recurrence.',
  [SPLIIT_SCOPES.expensesDelete]:
    'Read and delete expenses, and make edits that drop data such as shortening a recurring series. Never granted by default.',
  [ASSISTANT_WRITE_SCOPE]:
    'Create an expense through the assistant preview and confirmation flow. Does not grant direct writes.',
}

// OAuth contract per procedure, read off the router rather than restated here:
// `apiProcedure`, `scopedGroupReadProcedure` and `assistantProcedure` record
// the required scope, the bearer-only flag and conditional scopes in tRPC
// meta, so a procedure that changes requirement updates the spec on the next
// build. Keep the router import lazy: loading it also initializes
// better-auth, and the handlers above must be installed before Better Auth
// 1.7 starts its resource seed.
//
// Exported for `src/lib/openapi/trpc-contract.test.ts`, which asserts the
// generated authorization contract instead of duplicating it.
export type ProcedureContract = {
  scope: string
  oauthOnly: boolean
  conditionalScopes: Array<{ scope: string; when: string }>
}

export async function buildProcedureContracts(): Promise<
  Map<string, ProcedureContract>
> {
  const { appRouter } = await import('../src/trpc/routers/_app')
  return new Map<string, ProcedureContract>(
    Object.entries(appRouter._def.procedures).flatMap(([path, procedure]) => {
      const meta = (
        procedure as {
          _def?: {
            meta?: {
              scope?: string
              oauthOnly?: boolean
              conditionalScopes?: Array<{ scope: string; when: string }>
            }
          }
        }
      )._def?.meta
      return meta?.scope
        ? [
            [
              path,
              {
                scope: meta.scope,
                oauthOnly: meta.oauthOnly ?? false,
                conditionalScopes: meta.conditionalScopes ?? [],
              },
            ] as [string, ProcedureContract],
          ]
        : []
    }),
  )
}

// Procedures that don't require authentication. The generator emits no
// auth metadata, so we apply `security` globally and override these to
// `security: []` so the spec accurately reflects public access.
const PUBLIC_PROCEDURES = new Set<string>([
  'features.get',
  'currency.getRate',
  'invitations.previewLink',
  'ai.extractExpenseInformationFromImage',
])

// Procedures behind the `PUBLIC_ENABLE_BULK_CATEGORIZE` feature flag
// (default off). Marked `deprecated: true` in the spec and tagged with a
// description note so Scalar renders them with a warning badge and
// external consumers know not to depend on them. The flag is a
// frontend-only gate today — these procedures remain callable by admins
// regardless — but the whole flow is undergoing rework (see
// `handoff/bulk-categorizer-spike.md`) and the wire shape may change.
const DEPRECATED_PROCEDURES = new Set<string>([
  'ai.bulkCategorize.listCandidates',
  'ai.bulkCategorize.calibrate',
  'ai.bulkCategorize.preview',
  'groups.expenses.bulkUpdateCategories',
])
const DEPRECATION_NOTE =
  'Behind the `PUBLIC_ENABLE_BULK_CATEGORIZE` feature flag (default off). Undergoing rework — not for external consumption.'

// Session cookie name. better-auth uses `better-auth.session_token` by
// default; under `useSecureCookies` (production) it becomes
// `__Secure-better-auth.session_token`. Both names are documented in
// the security scheme description so consumers can pick the right one
// for their environment.
const SESSION_COOKIE_NAME = 'better-auth.session_token'
const SESSION_COOKIE_NAME_SECURE = '__Secure-better-auth.session_token'

async function main() {
  const doc = await generateOpenAPIDocument(routerPath, {
    exportName: 'appRouter',
    title: 'Spliit API',
    version: '0.1.0',
    servers: [{ url: '/trpc', description: 'tRPC mount point' }],
  })
  const procedureContracts = await buildProcedureContracts()

  // SAFETY: @trpc/openapi's generated document is structurally compatible with openapi-types' Document;
  // cast via unknown to compose with hand-written paths in a single strongly-typed object.
  const merged = await postProcess(
    doc as unknown as OpenAPIV3_1.Document,
    procedureContracts,
  )
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(merged, null, 2) + '\n', 'utf8')

  const opCount = Object.values(merged.paths ?? {}).reduce((sum, item) => {
    if (!item) return sum
    const methods = ['get', 'post', 'put', 'delete', 'patch'] as const
    return (
      sum +
      methods.filter((m) => (item as Record<string, unknown>)[m] != null).length
    )
  }, 0)
  console.log(
    `Wrote ${outputPath} (${opCount} operations across ${
      Object.keys(merged.paths ?? {}).length
    } paths)`,
  )
}

async function postProcess(
  doc: OpenAPIV3_1.Document,
  procedureContracts: ReadonlyMap<string, ProcedureContract>,
): Promise<OpenAPIV3_1.Document> {
  return postProcessOpenApiDocument(doc, procedureContracts)
}

/**
 * Compose the final document from the tRPC-generated base. Exported for
 * contract tests; `main` below is the only production caller.
 */
export async function postProcessOpenApiDocument(
  doc: OpenAPIV3_1.Document,
  procedureContracts: ReadonlyMap<string, ProcedureContract>,
): Promise<OpenAPIV3_1.Document> {
  const result: OpenAPIV3_1.Document = structuredClone(doc)
  result.paths = result.paths ?? {}
  result.components = result.components ?? {}

  // Root description — critical for external consumers since the spec is
  // tRPC-shaped (dotted paths, envelope responses, `?input=<json>` GET).
  result.info = {
    ...result.info,
    title: result.info?.title ?? 'Spliit API',
    version: result.info?.version ?? '0.1.0',
    description: ROOT_DESCRIPTION,
  }

  // Security scheme (cookie session).
  result.components.securitySchemes = {
    ...result.components.securitySchemes,
    session: {
      type: 'apiKey',
      in: 'cookie',
      name: SESSION_COOKIE_NAME,
      description:
        `Session cookie issued by better-auth after sign-in. ` +
        `Default non-secure name is \`${SESSION_COOKIE_NAME}\`; in production ` +
        `(HTTPS, \`useSecureCookies\`) the cookie is prefixed with \`__Secure-\` ` +
        `i.e. \`${SESSION_COOKIE_NAME_SECURE}\`. Send credentials on every ` +
        `cross-origin request (\`credentials: 'include'\` in the browser; ` +
        `\`Cookie: <name>=<value>\` from other clients).`,
    },
    oauth2: {
      type: 'oauth2',
      description:
        `OAuth 2.1 with PKCE, for scripts and agents that cannot hold a ` +
        `browser session. Clients may register dynamically at ` +
        `\`POST /auth/oauth2/register\`. Omitting \`scope\` when authorizing ` +
        `grants the read-only defaults; manage and delete scopes ` +
        `such as \`${SPLIIT_SCOPES.expensesManage}\` or ` +
        `\`${SPLIIT_SCOPES.groupsDelete}\` must be requested explicitly ` +
        `and approved on the consent screen, including when widening an ` +
        `existing client. ` +
        `Omitting \`resource\` binds the authorization to this API. Access ` +
        `tokens last at most one hour and stop working as soon as the app ` +
        `is disconnected; refresh tokens rotate on every renewal. ` +
        `Send the token as \`Authorization: Bearer <token>\`.`,
      flows: {
        authorizationCode: {
          authorizationUrl: '/auth/oauth2/authorize',
          tokenUrl: '/auth/oauth2/token',
          refreshUrl: '/auth/oauth2/token',
          scopes: SCOPE_DESCRIPTIONS,
        },
      },
    },
  }
  result.security = [{ session: [] }]

  // Override security on public procedures; tag every operation;
  // extract summary from JSDoc description (first paragraph becomes
  // `summary`, the rest stays as `description` with the procedure
  // footnote appended).
  for (const [path, item] of Object.entries(result.paths)) {
    if (!item) continue
    for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
      const op = (
        item as Record<string, OpenAPIV3_1.OperationObject | undefined>
      )[method]
      if (!op) continue
      const procPath = stripTrpcPrefix(path)
      const tags = op.tags ?? []
      const routerTag = procPath.split('.')[0] || 'default'
      op.tags = Array.from(new Set([routerTag, ...tags]))
      const footnote = `_tRPC procedure: \`${procPath}\`_`
      if (op.description) {
        const breakIdx = op.description.indexOf('\n\n')
        if (breakIdx >= 0) {
          op.summary = op.description.slice(0, breakIdx).trim()
          const rest = op.description.slice(breakIdx + 2).trim()
          op.description = rest ? `${rest}\n\n${footnote}` : footnote
        } else {
          op.summary = op.description.trim()
          op.description = footnote
        }
      } else {
        op.description = footnote
      }
      if (PUBLIC_PROCEDURES.has(procPath)) {
        op.security = []
      } else {
        // A scoped procedure takes a session or a token holding the scope,
        // unless it is bearer-only (the assistant surface rejects sessions).
        // Conditional scopes add security alternatives covering the wider
        // grant plus a description sentence naming the condition.
        const contract = procedureContracts.get(procPath)
        if (contract) {
          op.security = buildProcedureSecurity(contract)
          for (const conditional of contract.conditionalScopes) {
            op.description =
              `${op.description ?? ''}\n\nOAuth callers additionally require \`${conditional.scope}\` when ${conditional.when}.`.trim()
          }
          if (contract.oauthOnly) {
            op.description =
              `OAuth bearer authentication required; cookie sessions are not accepted.\n\n${op.description ?? ''}`.trim()
          }
        }
      }
      if (DEPRECATED_PROCEDURES.has(procPath)) {
        op.deprecated = true
        op.description = `${DEPRECATION_NOTE}\n\n${op.description ?? ''}`.trim()
      }
    }
  }

  // Merge in remaining REST operations: auto-generated auth paths from
  // better-auth's `openAPI` plugin, and hand-maintained export paths.
  const authPaths = await buildAuthPaths()
  Object.assign(result.paths, authPaths.paths, buildExportPaths())

  // Auth and export endpoints aren't mounted under `/trpc`, so each of
  // their operations needs an explicit `servers: [{ url: '/' }]` override
  // — otherwise Scalar would prefix the path with the document-level
  // `/trpc` server URL and resolve `/auth/sign-in/email` to
  // `/trpc/auth/sign-in/email`, which the API never serves. tRPC
  // procedures keep inheriting the document-level `/trpc` server.
  for (const [path, item] of Object.entries(result.paths)) {
    if (!item) continue
    if (!isRestPath(path)) continue
    for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
      const op = (
        item as Record<string, OpenAPIV3_1.OperationObject | undefined>
      )[method]
      if (!op) continue
      op.servers = ROOT_SERVER
    }
  }

  // The auth plugin's response bodies reference the auth model schemas
  // (`User`, `Session`, etc.) via `$ref`. Merge those into the document's
  // `components.schemas` so the refs resolve.
  if (authPaths.schemas) {
    result.components.schemas = {
      ...result.components.schemas,
      ...authPaths.schemas,
    }
  }

  result.tags = buildTags()
  return result
}

function stripTrpcPrefix(path: string): string {
  // @trpc/openapi emits paths as the dotted procedure name with a
  // leading slash, e.g. `/groups.expenses.create`.
  return path.replace(/^\//, '').replace(/\//g, '.')
}

function isRestPath(path: string): boolean {
  // REST routes outside the tRPC mount: better-auth (`/auth/*`, emitted
  // by the `openAPI` plugin in `buildAuthPaths`) and the group expense
  // exports (hand-maintained in `buildExportPaths`).
  // Everything else is a tRPC procedure.
  return (
    path.startsWith('/auth/') ||
    path.includes('/expenses/export/') ||
    path.endsWith('/export/bundle')
  )
}

export function acceptedOAuthScopes(requiredScope: string): string[] {
  if (requiredScope === SPLIIT_SCOPES.groupsRead) {
    return [
      SPLIIT_SCOPES.groupsRead,
      SPLIIT_SCOPES.groupsManage,
      SPLIIT_SCOPES.groupsDelete,
    ]
  }
  if (requiredScope === SPLIIT_SCOPES.expensesRead) {
    return [
      SPLIIT_SCOPES.expensesRead,
      SPLIIT_SCOPES.expensesManage,
      SPLIIT_SCOPES.expensesDelete,
    ]
  }
  return [requiredScope]
}

/**
 * Security alternatives for one procedure: the cookie session (unless the
 * procedure is bearer-only), one OAuth entry per accepted scope for the base
 * requirement, and one entry per conditional scope combining it with the base
 * requirement it extends.
 */
export function buildProcedureSecurity(
  contract: ProcedureContract,
): Array<Record<string, string[]>> {
  const base = acceptedOAuthScopes(contract.scope)
  const oauth: Array<Record<string, string[]>> = base.map((acceptedScope) => ({
    oauth2: [acceptedScope],
  }))
  for (const conditional of contract.conditionalScopes) {
    for (const acceptedScope of base) {
      if (acceptedScope === conditional.scope) continue
      oauth.push({ oauth2: [acceptedScope, conditional.scope] })
    }
  }
  return contract.oauthOnly ? oauth : [{ session: [] }, ...oauth]
}

// Root-path server (empty URL resolves to the spec's own origin) is
// applied per-operation to REST paths that aren't mounted under `/trpc`:
// better-auth (`/auth/*`) and the group expense exports
// (`/groups/:groupId/export/bundle` and `/groups/:groupId/expenses/export/*`). The document-level `servers`
// of `/trpc` would otherwise prefix these paths with `/trpc/`, breaking
// the URL Scalar hands to its "Test Request" client.
const ROOT_SERVER: OpenAPIV3_1.ServerObject[] = [
  { url: '/', description: 'API root (REST endpoints outside tRPC)' },
]

/**
 * Auth paths auto-generated by better-auth's `openAPI` plugin.
 *
 * The plugin introspects every registered endpoint (core sign-in/up/out,
 * session, email verification, password reset + the `magicLink` plugin) and
 * emits accurate OpenAPI paths, request bodies, and error responses. This
 * replaces the previous hand-maintained auth paths that had drifted from the
 * real routes (e.g. magic-link is `/sign-in/magic-link`, not
 * `/magic-link/generate`).
 *
 * Post-processing applied to each operation:
 *
 * - **Path prefix**: better-auth emits paths relative to its `basePath`
 *   (`/auth`), e.g. `/sign-in/magic-link`. We prefix with `/auth` so the spec
 *   shows the full URL the API actually serves.
 * - **Security remap**: the plugin emits `security: [{ bearerAuth: [] }]` (and a
 *   generic `apiKeyCookie` scheme with a placeholder cookie name). We remap to
 *   our `session` cookie scheme, which documents the real cookie name
 *   (`better-auth.session_token` / `__Secure-better-auth.session_token`).
 *   Anonymous endpoints (sign-in, sign-up, magic-link request, OAuth callbacks,
 *   token-based flows) get `security: []`; UserInfo uses the OAuth scheme.
 * - **Tag normalisation**: rename the plugin's `Default` tag (core endpoints) to
 *   `auth` for consistency with the rest of the Spliit API tags; lowercase
 *   `Magic-link` → `magic-link`.
 */
async function buildAuthPaths(): Promise<{
  paths: Record<string, OpenAPIV3_1.PathItemObject>
  schemas: Record<string, OpenAPIV3_1.SchemaObject>
}> {
  // Better Auth 1.7 needs a database to introspect its complete schema. Docker
  // deliberately builds without one, so retain the core OAuth protocol paths
  // from a tested static fallback while local generation adds the full auth API.
  if (process.env.SKIP_AUTH_OPENAPI === '1') {
    console.warn(
      '[openapi] SKIP_AUTH_OPENAPI=1 — using static OAuth paths (build without DB)',
    )
    return { paths: buildOAuthProtocolFallbackPaths(), schemas: {} }
  }
  type AuthModule = typeof import('../src/lib/auth')
  let authSchema: Awaited<
    ReturnType<AuthModule['auth']['api']['generateOpenAPISchema']>
  >
  try {
    const { auth } = await import('../src/lib/auth')
    authSchema = await auth.api.generateOpenAPISchema()
  } catch (err) {
    // better-auth 1.7's oauth provider now queries OauthResource at schema
    // generation time. In Docker/CI builds there is no DB, so this throws
    // DatabaseNotReachable (P1001) and breaks `Build api`. Degrade gracefully
    // — the tRPC, OAuth protocol and export paths are still emitted.
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[openapi] auth.api.generateOpenAPISchema() failed (no DB at build?) — using static OAuth paths: ${msg}`,
    )
    return { paths: buildOAuthProtocolFallbackPaths(), schemas: {} }
  }
  const paths: Record<string, OpenAPIV3_1.PathItemObject> = {}
  for (const [path, item] of Object.entries(authSchema.paths ?? {})) {
    if (!item) continue
    // better-auth emits paths relative to its basePath; prefix with
    // `/auth` so the spec shows the full URL the API serves.
    const fullPath = path.startsWith('/') ? `/auth${path}` : `/auth/${path}`
    const newItem = structuredClone(item) as OpenAPIV3_1.PathItemObject
    for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
      const op = (
        newItem as Record<string, OpenAPIV3_1.OperationObject | undefined>
      )[method]
      if (!op) continue
      applyOAuthOperationContract(fullPath, method, op)
      // Normalise tags: `Default` (core) → `auth`; `Magic-link` → `magic-link`.
      op.tags = (op.tags ?? []).map((tag) =>
        tag === 'Default' ? 'auth' : tag === 'Magic-link' ? 'magic-link' : tag,
      )
      if (op.tags.length === 0) op.tags = ['auth']
    }
    paths[fullPath] = newItem
  }
  // SAFETY: better-auth's openAPI plugin emits JSON Schema compatible with OpenAPI 3.1 SchemaObject; cast via unknown to satisfy openapi-types.
  const schemas = (authSchema.components?.schemas ?? {}) as unknown as Record<
    string,
    OpenAPIV3_1.SchemaObject
  >
  return { paths, schemas }
}

/**
 * Hand-maintained OpenAPI paths for the group bundle/CSV exports. These are
 * Hono routes outside tRPC and outside better-auth, so they can't be
 * auto-generated — they're documented here manually.
 */
function buildExportPaths(): Record<string, OpenAPIV3_1.PathItemObject> {
  const groupIdParam: OpenAPIV3_1.ParameterObject = {
    name: 'groupId',
    in: 'path',
    required: true,
    schema: { type: 'string', minLength: 1 },
    description: 'Group id.',
  }

  const errorResponse = (description: string, example: string) =>
    ({
      description,
      content: {
        'application/json': {
          schema: { type: 'object' },
          example,
        },
      },
    }) satisfies OpenAPIV3_1.ResponseObject

  return {
    '/account/export/bundle': {
      post: {
        tags: ['account'],
        summary: 'Download a selective account export bundle',
        description:
          'Stream a ZIP containing the selected account preferences and group snapshots. Requires an authenticated account.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'sections',
                  'groupOverrides',
                  'includeDocuments',
                  'includeAccountPreferences',
                  'includeGroupPreferences',
                ],
                properties: {
                  sections: {
                    type: 'object',
                    required: [
                      'GROUPS',
                      'FRIENDS',
                      'STARRED',
                      'ARCHIVED',
                      'HIDDEN',
                    ],
                    properties: {
                      GROUPS: { type: 'boolean' },
                      FRIENDS: { type: 'boolean' },
                      STARRED: { type: 'boolean' },
                      ARCHIVED: { type: 'boolean' },
                      HIDDEN: { type: 'boolean' },
                    },
                  },
                  groupOverrides: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['groupSourceId', 'included'],
                      properties: {
                        groupSourceId: { type: 'string' },
                        included: { type: 'boolean' },
                      },
                    },
                  },
                  includeDocuments: { type: 'boolean' },
                  includeAccountPreferences: { type: 'boolean' },
                  includeGroupPreferences: { type: 'boolean' },
                },
              },
            },
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['selection'],
                properties: { selection: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'ZIP file (Content-Disposition: attachment).',
            content: {
              'application/zip': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '400': errorResponse('Invalid export selection', '{"error":"..."}'),
          '401': errorResponse(
            'Unauthenticated',
            '{"error":"Unauthenticated"}',
          ),
        },
      },
    },
    '/groups/{groupId}/export/bundle': {
      parameters: [groupIdParam],
      get: {
        tags: ['groups'],
        summary: 'Download a portable group export bundle',
        description:
          'Stream a ZIP containing the group manifest and available expense documents. Requires an active membership.',
        responses: {
          '200': {
            description: 'ZIP file (Content-Disposition: attachment).',
            content: {
              'application/zip': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '401': errorResponse(
            'Unauthenticated',
            '{"error":"Unauthenticated"}',
          ),
          '403': errorResponse('Forbidden', '{"error":"Forbidden"}'),
          '404': errorResponse(
            'Invalid group ID',
            '{"error":"Invalid group ID"}',
          ),
        },
      },
    },
    '/groups/{groupId}/expenses/export/csv': {
      parameters: [groupIdParam],
      get: {
        tags: ['groups'],
        summary: 'Download a CSV export of the group expenses',
        description:
          'Stream the group expenses as a CSV file download. Requires an active membership.',
        responses: {
          '200': {
            description: 'CSV file (Content-Disposition: attachment).',
            content: {
              'text/csv': { schema: { type: 'string' } },
            },
          },
          '401': errorResponse(
            'Unauthenticated',
            '{"error":"Unauthenticated"}',
          ),
          '403': errorResponse('Forbidden', '{"error":"Forbidden"}'),
          '404': errorResponse(
            'Invalid group ID',
            '{"error":"Invalid group ID"}',
          ),
        },
      },
    },
  }
}

function buildTags(): OpenAPIV3_1.TagObject[] {
  return [
    {
      name: 'auth',
      description:
        'better-auth core endpoints (sign-in, sign-up, sign-out, session, email verification, password reset). Auto-generated by the `openAPI` plugin. Sign-in/sign-up return a session cookie that authenticates the other routes.',
    },
    {
      name: 'magic-link',
      description:
        'Magic-link sign-in plugin endpoints (request + verify). Auto-generated by the `openAPI` plugin.',
    },
    {
      name: 'groups',
      description: 'Group CRUD + expenses + balances + activities + exports.',
    },
    {
      name: 'account',
      description: 'Authenticated account profile and per-group preferences.',
    },
    {
      name: 'ai',
      description:
        'AI-assisted extraction (receipt → expense fields, title → category). Some procedures are public for unauthenticated previews.',
    },
    {
      name: 'currency',
      description: 'Single + bulk FX lookups against the Frankfurter provider.',
    },
    {
      name: 'features',
      description: 'Public feature flags (used by the web client at boot).',
    },
    {
      name: 'friends',
      description: 'Friends and friend-ledger invitations.',
    },
    {
      name: 'invitations',
      description: 'Group invitations (email + link) and accept/decline flows.',
    },
    {
      name: 'uploads',
      description:
        'S3/R2 presigned upload URLs for expense documents and profile images.',
    },
  ]
}

const ROOT_DESCRIPTION = `
The Spliit API is a [tRPC](https://trpc.io) server mounted at \`/trpc\` with
the [superjson](https://github.com/flightcontrolhq/superjson) transformer.
Every operation in this spec is a tRPC procedure that follows the
tRPC-over-HTTP wire convention:

- **Paths are dotted procedure names.** A path like
  \`/groups.expenses.create\` corresponds to the tRPC procedure
  \`groups.expenses.create\` and resolves to
  \`POST /trpc/groups.expenses.create\` at runtime.
- **Queries are GET, mutations are POST.** Anything else returns \`405\`
  (\`Unsupported POST-request to query procedure …\`).
- **Inputs must be superjson-wrapped in a \`json\` key.** This is the most
  common mistake: sending the raw input object fails with
  \`400 "Invalid input: expected object, received undefined"\`.
  - Batch GET query:
    \`GET /trpc/<proc>?batch=1&input={"0":{"json":{...}}}\`
    (\`input\` is urlencoded; \`0\` is the batch index).
  - Single (non-batch) GET: \`?input={"json":{...}}\`.
  - Procedures that take no input still need an (empty) wrapper:
    \`?batch=1&input={"0":{"json":{}}}\`.
  - Mutations: \`POST /trpc/<proc>?batch=1\` with JSON body
    \`{"0":{"json":{...}}}\` (single: \`{"json":{...}}\`).
- **Responses are wrapped twice, and batched calls return arrays.**
  A successful batch response looks like
  \`[{ "result": { "data": { "json": <T> } } }]\` in call order (drop the
  outer array and the \`0\` keys for single calls). A superjson \`"meta"\`
  key may sit next to \`"json"\` when the payload contains
  \`Date\`/\`Map\`/\`Set\` — otherwise dates arrive as ISO-8601 strings
  inside \`json\`. Errors look like
  \`{ "error": { "json": { "message": "…", "code": -32600, "data": {
  "code": "UNAUTHORIZED", "httpStatus": 401 } } } }\`. The
  \`components.schemas\` describe the unwrapped \`T\`; apply both envelopes
  on the wire.
- **Authentication: Bearer token or session cookie.** Send
  \`Authorization: Bearer <access-token>\` (OAuth — the scopes each
  operation needs are listed in its \`security\` section) or a better-auth
  session cookie. They are not equivalent: session-only procedures reject
  OAuth tokens with \`401 "Authentication required"\` (e.g. the global
  \`expenses.*\` procedures) — use the per-group equivalents
  (\`groups.expenses.*\`), which accept OAuth scopes, instead.

For TypeScript consumers, generate a typed client with
[@hey-api/openapi-ts](https://github.com/hey-api/openapi-ts) using the
\`@trpc/openapi/heyapi\` resolvers and pass \`transformer: superjson\` at
runtime — that handles \`Date\` / \`Map\` / \`Set\` round-tripping correctly.

For non-TS hand-callers (curl, Postman, other languages) the same
conventions apply: send credentials, wrap every input in the superjson
\`{"json":…}\` envelope described above, and unwrap the double response
envelope to reach \`T\`.

Authentication is **cookie-based**, served by [better-auth](https://better-auth.com).
Sign in via \`POST /auth/sign-in/email\` (email + password) or
\`POST /auth/sign-in/magic-link\` (passwordless magic link) to receive a
session cookie (\`better-auth.session_token\`, or
\`__Secure-better-auth.session_token\` in production); send it with every
subsequent request. See the \`session\` security scheme below.

The full list of \`/auth/*\` endpoints — sign-in/sign-up/sign-out, session,
email verification, password reset, social sign-in, account linking,
magic-link, and more — is auto-generated by better-auth's
[\`openAPI\` plugin](https://better-auth.com/docs/plugins/open-api) so it
stays in sync with the actual routes. The group export endpoints are
hand-maintained Hono routes (bundle/CSV downloads).
`.trim()

// Only run on direct invocation (`bun run generate-openapi`). Importing this
// module from contract tests must not write `openapi.json` as a side effect.
if (process.argv[1]?.includes('generate-openapi')) {
  main().catch((err) => {
    console.error('Failed to generate OpenAPI spec:', err)
    process.exit(1)
  })
}
