import { resolve } from 'node:path'

import { generateOpenAPIDocument } from '@trpc/openapi'
import type { OpenAPIV3_1 } from 'openapi-types'
import { describe, expect, it } from 'vitest'

import '../../test/mocks'
import {
  acceptedOAuthScopes,
  buildProcedureContracts,
  buildProcedureSecurity,
  postProcessOpenApiDocument,
} from '../../../scripts/generate-openapi'
import { SPLIIT_SCOPES } from '../auth/scopes'

const ROUTER_PATH = resolve(__dirname, '..', '..', 'trpc', 'routers', '_app.ts')

async function generateTestDocument(): Promise<OpenAPIV3_1.Document> {
  const doc = await generateOpenAPIDocument(ROUTER_PATH, {
    exportName: 'appRouter',
    title: 'Spliit API',
    version: '0.1.0',
    servers: [{ url: '/trpc', description: 'tRPC mount point' }],
  })
  const contracts = await buildProcedureContracts()
  return postProcessOpenApiDocument(
    doc as unknown as OpenAPIV3_1.Document,
    contracts,
  )
}

function operation(
  doc: OpenAPIV3_1.Document,
  path: string,
  method: 'get' | 'post' = 'post',
): OpenAPIV3_1.OperationObject {
  const item = doc.paths?.[path] as
    | Record<string, OpenAPIV3_1.OperationObject | undefined>
    | undefined
  const op = item?.[method]
  if (!op) throw new Error(`missing operation ${method} ${path}`)
  return op
}

describe('procedure authorization contracts', () => {
  it('derives every scoped procedure from router metadata', async () => {
    const contracts = await buildProcedureContracts()

    expect(contracts.get('groups.expenses.update')).toMatchObject({
      scope: SPLIIT_SCOPES.expensesManage,
      oauthOnly: false,
    })
    expect(contracts.get('groups.expenses.update')?.conditionalScopes).toEqual([
      {
        scope: SPLIIT_SCOPES.expensesDelete,
        when: expect.stringContaining('THIS_AND_FUTURE'),
      },
    ])
    expect(contracts.get('groups.archive')?.conditionalScopes).toEqual([
      {
        scope: SPLIIT_SCOPES.expensesManage,
        when: expect.stringContaining('force'),
      },
    ])
    expect(
      contracts.get('groups.participants.remove')?.conditionalScopes,
    ).toEqual([
      {
        scope: SPLIIT_SCOPES.expensesManage,
        when: expect.stringContaining('settleBalances'),
      },
    ])
    for (const path of ['assistant.listGroups', 'assistant.prepareExpense']) {
      expect(contracts.get(path)).toMatchObject({ oauthOnly: true })
    }
  })

  it('never advertises session authentication for bearer-only procedures', async () => {
    const doc = await generateTestDocument()

    for (const path of Object.keys(doc.paths ?? {})) {
      if (!path.startsWith('/assistant.')) continue
      for (const method of ['get', 'post'] as const) {
        const item = doc.paths?.[path] as
          | Record<string, OpenAPIV3_1.OperationObject | undefined>
          | undefined
        const op = item?.[method]
        if (!op) continue
        const security = JSON.stringify(op.security ?? [])
        expect(security).not.toContain('"session"')
        expect(security).toContain('oauth2')
        expect(op.description ?? '').toContain(
          'cookie sessions are not accepted',
        )
      }
    }
  })

  it('documents the conditional delete scope on expense updates', async () => {
    const doc = await generateTestDocument()
    const op = operation(doc, '/groups.expenses.update')

    expect(op.security).toContainEqual({
      oauth2: [SPLIIT_SCOPES.expensesManage, SPLIIT_SCOPES.expensesDelete],
    })
    expect(op.security).toContainEqual({ session: [] })
    expect(op.description ?? '').toContain(SPLIIT_SCOPES.expensesDelete)
  })

  it('documents conditional expense management on archive and participant removal', async () => {
    const doc = await generateTestDocument()

    for (const path of ['/groups.archive', '/groups.participants.remove']) {
      const op = operation(doc, path)
      expect(op.security).toContainEqual({
        oauth2: [SPLIIT_SCOPES.groupsDelete, SPLIIT_SCOPES.expensesManage],
      })
      expect(op.description ?? '').toContain(SPLIIT_SCOPES.expensesManage)
    }
  })

  it('keeps the read hierarchy in the accepted OAuth scopes', () => {
    expect(acceptedOAuthScopes(SPLIIT_SCOPES.groupsRead)).toEqual([
      SPLIIT_SCOPES.groupsRead,
      SPLIIT_SCOPES.groupsManage,
      SPLIIT_SCOPES.groupsDelete,
    ])
    expect(
      buildProcedureSecurity({
        scope: SPLIIT_SCOPES.groupsRead,
        oauthOnly: false,
        conditionalScopes: [],
      }),
    ).toContainEqual({ session: [] })
    expect(
      buildProcedureSecurity({
        scope: SPLIIT_SCOPES.groupsRead,
        oauthOnly: true,
        conditionalScopes: [],
      }),
    ).not.toContainEqual({ session: [] })
  })

  it('documents the superjson wire envelopes hand-callers need', async () => {
    const doc = await generateTestDocument()
    const description = doc.info.description ?? ''

    // Agents calling tRPC over HTTP must wrap inputs in {"json":…} and
    // unwrap the double response envelope — raw objects fail with 400.
    expect(description).toContain('{"json"')
    expect(description).toContain('"meta"')
    expect(description).toContain('result')
    expect(description).toContain('Bearer')
    expect(description).toContain('Authentication required')
  })

  it('keeps the OAuth protocol paths in the production fallback document', async () => {
    const previous = process.env.SKIP_AUTH_OPENAPI
    process.env.SKIP_AUTH_OPENAPI = '1'
    try {
      const doc = await generateTestDocument()

      // The database-free container build must still ship the protocol
      // surface agents need to register and authorize...
      for (const path of [
        '/auth/oauth2/register',
        '/auth/oauth2/authorize',
        '/auth/oauth2/token',
      ]) {
        expect(doc.paths?.[path], path).toBeDefined()
      }
      // ...without losing the tRPC authorization contract.
      const update = operation(doc, '/groups.expenses.update')
      expect(update.security).toContainEqual({
        oauth2: [SPLIIT_SCOPES.expensesManage, SPLIIT_SCOPES.expensesDelete],
      })
    } finally {
      if (previous === undefined) delete process.env.SKIP_AUTH_OPENAPI
      else process.env.SKIP_AUTH_OPENAPI = previous
    }
  })
})
