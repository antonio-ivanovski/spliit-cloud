import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('offline-contract browser safety', () => {
  it('exports a browser-safe offline contract', async () => {
    const offlinePath = resolve(__dirname, 'offline.ts')
    const source = readFileSync(offlinePath, 'utf8')

    const forbidden = [
      '@spliit/db',
      'lib/auth',
      'lib/api',
      'routers/',
      'trpc/init',
      'createTRPCRouter',
      'protectedProcedure',
      'getApiBaseUrl',
      'better-auth',
      'process.env',
    ]
    const importLines = source
      .split('\n')
      .filter((line) => line.trim().startsWith('import'))
    for (const token of forbidden) {
      expect(
        importLines.some((line) => line.includes(token)),
        `offline contract must not import ${token}`,
      ).toBe(false)
    }
    // Prisma may be mentioned in comments documenting browser-safety, but must
    // never appear in an import.
    expect(
      importLines.some(
        (line) => line.includes('prisma') || line.includes('Prisma'),
      ),
      'offline contract must not import prisma',
    ).toBe(false)

    expect(source).toContain("from 'zod'")
    expect(source).toContain('overviewGroupSchema')
    expect(source).toContain('globalExpenseGroupSchema')
    expect(source).toContain('getGroupOutputSchema')
    expect(source).toContain('listBalancesOutputSchema')

    const contract = await import('../outputs/offline')
    expect(contract.OFFLINE_SCHEMA_VERSION).toBe(2)
    expect(contract.OFFLINE_MAX_EXPENSES).toBe(500)
    expect(contract.OFFLINE_MAX_ACTIVITIES).toBe(200)
    expect(contract.offlineCatalogOutputSchema).toBeDefined()
    expect(contract.offlineSnapshotOutputSchema).toBeDefined()
    expect(contract.offlineExpenseRecordSchema).toBeDefined()
    expect(contract.offlineDocumentMetadataSchema).toBeDefined()
    expect(contract.offlineExpenseCommentSchema).toBeDefined()
    expect(contract.offlineGroupDataSchema).toBeDefined()

    const pkgPath = resolve(__dirname, '..', '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      exports: Record<string, string>
    }
    expect(pkg.exports['./offline-contract']).toBe(
      './src/trpc/outputs/offline.ts',
    )
  })

  it('composes stable revision tokens from content and viewer revisions', async () => {
    const {
      buildOfflineRevisionToken,
      parseOfflineRevisionToken,
      isSameOfflineRevision,
      OFFLINE_CONTRACT_VERSION,
    } = await import('../outputs/offline')

    expect(
      buildOfflineRevisionToken({ contentRevision: 7n, viewerRevision: 3n }),
    ).toBe(`o${OFFLINE_CONTRACT_VERSION}.c7.v3`)
    expect(
      buildOfflineRevisionToken({ contentRevision: 7, viewerRevision: 0 }),
    ).toBe(`o${OFFLINE_CONTRACT_VERSION}.c7.v0`)

    const parsed = parseOfflineRevisionToken(
      buildOfflineRevisionToken({ contentRevision: 12n, viewerRevision: 0n }),
    )
    expect(parsed).toMatchObject({
      contractVersion: OFFLINE_CONTRACT_VERSION,
      contentRevision: '12',
      viewerRevision: '0',
    })
    expect(parseOfflineRevisionToken('o1.cundefined.v0')).toBeNull()
    expect(parseOfflineRevisionToken('stale')).toBeNull()

    const token = buildOfflineRevisionToken({
      contentRevision: 1n,
      viewerRevision: 0n,
    })
    expect(isSameOfflineRevision(token, token)).toBe(true)
    expect(
      isSameOfflineRevision(
        token,
        buildOfflineRevisionToken({ contentRevision: 2n, viewerRevision: 0n }),
      ),
    ).toBe(false)
    // Cross-contract tokens never match, even when counters coincide.
    expect(
      isSameOfflineRevision(
        token,
        buildOfflineRevisionToken({
          contentRevision: 1n,
          viewerRevision: 0n,
          contractVersion: OFFLINE_CONTRACT_VERSION + 1,
        }),
      ),
    ).toBe(false)
  })

  it('requires revision tokens on catalog entries and snapshots', async () => {
    const { offlineCatalogEntrySchema, offlineSnapshotOutputSchema } =
      await import('../outputs/offline')
    expect(Object.keys(offlineCatalogEntrySchema.shape)).toContain('revision')
    expect(Object.keys(offlineSnapshotOutputSchema.shape)).toContain('revision')
  })

  it('strips document URLs from metadata', async () => {
    const { offlineDocumentMetadataSchema } = await import('../outputs/offline')
    expect(
      offlineDocumentMetadataSchema.safeParse({
        id: 'doc-1',
        fileName: 'receipt.jpg',
        contentType: 'image/jpeg',
        width: 100,
        height: 200,
      }).success,
    ).toBe(true)
    expect(
      offlineDocumentMetadataSchema.safeParse({
        id: 'doc-1',
        url: 'https://example.com/secret',
        fileName: 'receipt.jpg',
        contentType: 'image/jpeg',
        width: 100,
        height: 200,
      }).data,
    ).not.toHaveProperty('url')
  })
})
