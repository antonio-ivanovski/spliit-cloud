import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import {
  CREATE_MUTATION_CATALOG,
  CREATE_OPERATIONS,
  deriveCreateToken,
  idempotencyRequestHash,
  runIdempotentCreate,
} from './idempotency'

const routerRoot = fileURLToPath(
  new URL('../../trpc/routers/', import.meta.url),
)

function routerSources(directory = routerRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return routerSources(path)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts'))
      return []
    return [path]
  })
}

function discoverCreateMutations() {
  const discovered = new Set<string>()
  for (const path of routerSources()) {
    const source = readFileSync(path, 'utf8')
    if (!source.includes('.mutation')) continue
    const relativePath = path.slice(routerRoot.length).replace(/^\//, '')
    let hasExportedCreateProcedure = false
    for (const match of source.matchAll(
      /^export const (create[A-Z]\w*Procedure|importGroupProcedure|importCloudBundleProcedure)\s*=/gm,
    )) {
      hasExportedCreateProcedure ||= match[1]!.startsWith('create')
      discovered.add(`${relativePath}#${match[1]}`)
    }
    for (const match of source.matchAll(
      /^(?:export )?const (create)\s*=\s*protectedProcedure/gm,
    )) {
      discovered.add(`${relativePath}#${match[1]}`)
    }
    if (!hasExportedCreateProcedure) {
      for (const match of source.matchAll(/^  (create(?:[A-Z]\w*)?):\s/gm)) {
        discovered.add(`${relativePath}#${match[1]}`)
      }
    }
  }
  return [...discovered].sort()
}

describe('create idempotency primitives', () => {
  it('hashes semantically identical validated objects canonically', () => {
    expect(idempotencyRequestHash({ b: 2, a: { y: 2, x: 1 } })).toBe(
      idempotencyRequestHash({ a: { x: 1, y: 2 }, b: 2 }),
    )
    expect(idempotencyRequestHash({ amount: 100 })).not.toBe(
      idempotencyRequestHash({ amount: 101 }),
    )
  })

  it('derives stable domain-separated invitation tokens', () => {
    const base = {
      accountId: 'account-1',
      operation: CREATE_OPERATIONS.linkInvitation,
      requestId: '00000000-0000-4000-8000-000000000001',
      discriminator: 'invite-1',
    } as const
    expect(deriveCreateToken(base)).toBe(deriveCreateToken(base))
    expect(deriveCreateToken(base)).not.toBe(
      deriveCreateToken({ ...base, discriminator: 'invite-2' }),
    )
  })

  it('finishes external preparation before opening the transaction', async () => {
    const events: string[] = []
    prismaMock.idempotencyRequest.create.mockImplementation(async () => {
      events.push('marker')
      return {} as never
    })
    prismaMock.idempotencyRequest.update.mockImplementation(async () => {
      events.push('complete')
      return {} as never
    })

    const result = await runIdempotentCreate({
      accountId: 'account-1',
      operation: CREATE_OPERATIONS.expense,
      requestId: '00000000-0000-4000-8000-000000000002',
      input: { amount: 100 },
      prepare: async () => {
        events.push('prepare')
        return { conversion: 'resolved' }
      },
      execute: async (_tx, prepared) => {
        events.push('execute')
        return prepared
      },
    })

    expect(result).toEqual({
      value: { conversion: 'resolved' },
      replayed: false,
    })
    expect(events).toEqual(['prepare', 'marker', 'execute', 'complete'])
  })

  it('replays completed requests without repeating external preparation', async () => {
    const requestId = '00000000-0000-4000-8000-000000000003'
    const input = { amount: 100 }
    prismaMock.idempotencyRequest.findUnique.mockResolvedValue({
      requestHash: idempotencyRequestHash(input),
      result: { expenseId: 'expense-1' },
      completedAt: new Date(),
    } as never)
    const prepare = vi.fn(async () => ({ conversion: 'resolved' }))
    const execute = vi.fn(async () => ({ expenseId: 'unexpected' }))

    const result = await runIdempotentCreate({
      accountId: 'account-1',
      operation: CREATE_OPERATIONS.expense,
      requestId,
      input,
      prepare,
      execute,
      decode: (stored) => stored as { expenseId: string },
    })

    expect(result).toEqual({
      value: { expenseId: 'expense-1' },
      replayed: true,
    })
    expect(prepare).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a reused request ID before external preparation', async () => {
    prismaMock.idempotencyRequest.findUnique.mockResolvedValue({
      requestHash: idempotencyRequestHash({ amount: 100 }),
      result: { expenseId: 'expense-1' },
      completedAt: new Date(),
    } as never)
    const prepare = vi.fn(async () => ({ conversion: 'resolved' }))

    await expect(
      runIdempotentCreate({
        accountId: 'account-1',
        operation: CREATE_OPERATIONS.expense,
        requestId: '00000000-0000-4000-8000-000000000004',
        input: { amount: 101 },
        prepare,
        execute: async () => ({ expenseId: 'unexpected' }),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(prepare).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('maintains an explicit operation for every shared create flow', () => {
    expect(Object.keys(CREATE_OPERATIONS).sort()).toEqual(
      [
        'budget',
        'cloudImport',
        'emailInvitation',
        'expense',
        'expenseComment',
        'friendLedger',
        'group',
        'import',
        'linkInvitation',
        'participant',
        'subgroup',
      ].sort(),
    )
    expect(new Set(Object.values(CREATE_OPERATIONS)).size).toBe(
      Object.keys(CREATE_OPERATIONS).length,
    )

    const sharedEntries = CREATE_MUTATION_CATALOG.filter(
      (entry) => entry.mechanism === 'shared',
    )
    expect(sharedEntries.map((entry) => entry.operation).sort()).toEqual(
      Object.values(CREATE_OPERATIONS).sort(),
    )
    expect(
      CREATE_MUTATION_CATALOG.map(
        (entry) => `${entry.source}#${entry.symbol}`,
      ).sort(),
    ).toEqual(discoverCreateMutations())

    for (const entry of sharedEntries) {
      const source = readFileSync(`${routerRoot}${entry.source}`, 'utf8')
      expect(source).toContain('requestId')
      expect(source).toContain('runIdempotentCreate')
      expect(source).toContain(
        `CREATE_OPERATIONS.${
          Object.entries(CREATE_OPERATIONS).find(
            ([, operation]) => operation === entry.operation,
          )![0]
        }`,
      )
    }
  })
})
