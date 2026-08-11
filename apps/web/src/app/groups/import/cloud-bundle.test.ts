import { Zip, ZipPassThrough, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  MAX_CLOUD_BUNDLE_BYTES,
  MAX_CLOUD_BUNDLE_ENTRIES,
  MAX_CLOUD_BUNDLE_MANIFEST_BYTES,
  inspectSpliitCloudBundle,
} from './cloud-bundle'

const participant = {
  sourceId: 'participant-1',
  kind: 'UNLINKED_PARTICIPANT',
  displayName: 'Alex',
  removedAt: null,
  membership: null,
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    format: 'spliit.cloud/export',
    version: 1,
    scope: { type: 'GROUP', sourceId: 'group-1' },
    exportedAt: '2026-08-10T12:00:00.000Z',
    complete: true,
    warnings: [],
    group: {
      sourceId: 'group-1',
      name: 'Trip',
      information: null,
      archived: false,
      groupType: 'GROUP',
      subgroupsEnabled: false,
      createdAt: '2026-08-01T12:00:00.000Z',
      ledger: {
        sourceId: 'ledger-1',
        currency: '$',
        currencyCode: 'USD',
        createdAt: '2026-08-01T12:00:00.000Z',
      },
    },
    participants: [participant],
    subgroups: [],
    budgets: [],
    recurrenceSeries: [],
    expenses: [],
    orphanDocuments: [],
    ...overrides,
  }
}

function accountManifest(overrides: Record<string, unknown> = {}) {
  return {
    format: 'spliit.cloud/export',
    version: 1,
    scope: { type: 'ACCOUNT', sourceId: 'account-1' },
    exportedAt: '2026-08-10T12:00:00.000Z',
    complete: true,
    warnings: [],
    contents: {
      documents: true,
      accountPreferences: true,
      groupPreferences: true,
    },
    account: {
      sourceId: 'account-1',
      name: 'Alice',
      email: 'alice@example.com',
      preferences: {
        defaultCurrencyCode: 'USD',
        timeZone: null,
        locale: null,
        theme: null,
        aiFeaturesEnabled: null,
        aiCategoryExtractEnabled: null,
        aiReceiptScanEnabled: null,
        aiVoiceExpenseEnabled: null,
      },
      notificationPreferences: [],
    },
    identities: [
      { sourceId: 'account-1', name: 'Alice', email: 'alice@example.com' },
    ],
    groups: [
      {
        sourceId: 'group-1',
        displayName: 'Trip',
        groupType: 'GROUP',
        archived: false,
        manifestPath: 'groups/group-1/manifest.json',
        complete: true,
      },
    ],
    groupPreferences: [
      {
        groupSourceId: 'group-1',
        starred: true,
        hidden: false,
        defaultSplit: null,
      },
    ],
    ...overrides,
  }
}

async function checksum(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  )
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function bundleWithDocument(
  document: Record<string, unknown>,
  bytes = new TextEncoder().encode('receipt'),
) {
  const archivePath = document.path as string
  return new Blob([
    zipSync({
      'manifest.json': new TextEncoder().encode(
        JSON.stringify(
          manifest({
            orphanDocuments: [document],
          }),
        ),
      ),
      [archivePath]: bytes,
      'viewer/index.html': new TextEncoder().encode('optional viewer'),
    }),
  ])
}

async function archiveWithManyEntries(count: number) {
  const chunks: Uint8Array[] = []
  const archive = new Zip((error, chunk) => {
    if (error) throw error
    if (chunk) chunks.push(chunk)
  })
  const manifestEntry = new ZipPassThrough('manifest.json')
  archive.add(manifestEntry)
  manifestEntry.push(new TextEncoder().encode(JSON.stringify(manifest())), true)
  for (let index = 0; index < count; index += 1) {
    const entry = new ZipPassThrough(`extra/${index}`)
    archive.add(entry)
    entry.push(new Uint8Array(), true)
  }
  archive.end()
  return new Blob(chunks as unknown as BlobPart[])
}

describe('inspectSpliitCloudBundle', () => {
  it('rejects bundles over the compressed-size limit before reading them', async () => {
    const oversized = {
      size: MAX_CLOUD_BUNDLE_BYTES + 1,
      slice: () => {
        throw new Error('should not read an oversized bundle')
      },
    } as unknown as Blob
    await expect(inspectSpliitCloudBundle(oversized)).rejects.toThrow(
      /too large/i,
    )
  })

  it('rejects archives over the entry-count limit', async () => {
    await expect(
      inspectSpliitCloudBundle(
        await archiveWithManyEntries(MAX_CLOUD_BUNDLE_ENTRIES + 1),
      ),
    ).rejects.toThrow(/too many files/i)
  })

  it('rejects a manifest entry larger than the manifest limit', async () => {
    const archive = zipSync(
      {
        'manifest.json': new Uint8Array(MAX_CLOUD_BUNDLE_MANIFEST_BYTES + 1),
      },
      { level: 0 },
    )
    await expect(inspectSpliitCloudBundle(new Blob([archive]))).rejects.toThrow(
      /size limit/i,
    )
  })

  it('rejects an archive without manifest.json', async () => {
    await expect(
      inspectSpliitCloudBundle(
        new Blob([zipSync({ 'viewer/index.html': new Uint8Array([1]) })]),
      ),
    ).rejects.toThrow(/missing manifest/i)
  })

  it('streams a group manifest and validates the referenced document', async () => {
    const bytes = new TextEncoder().encode('receipt')
    const document = {
      sourceId: 'document-1',
      fileName: 'receipt.txt',
      contentType: 'text/plain',
      width: null,
      height: null,
      path: 'documents/_orphans/document-1__receipt.txt',
      status: 'INCLUDED',
      sizeBytes: bytes.byteLength,
      sha256: await checksum(bytes),
    }
    const result = await inspectSpliitCloudBundle(
      await bundleWithDocument(document, bytes),
    )
    expect(result.kind).toBe('GROUP')
    if (result.kind !== 'GROUP') throw new Error('Expected a group bundle')
    expect(result.manifest.group.sourceId).toBe('group-1')
    expect(result.documents.get('document-1')).toEqual(bytes)
    expect(result.documentIssues).toEqual([])
  })

  it('inspects an account bundle and returns its nested group inspections', async () => {
    const bytes = new TextEncoder().encode('account receipt')
    const document = {
      sourceId: 'document-1',
      fileName: 'receipt.txt',
      contentType: 'text/plain',
      width: null,
      height: null,
      path: 'groups/group-1/documents/document-1__receipt.txt',
      status: 'INCLUDED',
      sizeBytes: bytes.byteLength,
      sha256: await checksum(bytes),
    }
    const group = manifest({ orphanDocuments: [document] })
    const archive = zipSync({
      'manifest.json': new TextEncoder().encode(
        JSON.stringify(accountManifest()),
      ),
      'groups/group-1/manifest.json': new TextEncoder().encode(
        JSON.stringify(group),
      ),
      [document.path]: bytes,
      'viewer/index.html': new TextEncoder().encode('optional viewer'),
    })

    const result = await inspectSpliitCloudBundle(new Blob([archive]))

    expect(result.kind).toBe('ACCOUNT')
    if (result.kind !== 'ACCOUNT') throw new Error('Expected an account bundle')
    expect(result.manifest.scope.type).toBe('ACCOUNT')
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.inspection.documents.get('document-1')).toEqual(
      bytes,
    )
    expect(result.groups[0]?.inspection.documentIssues).toEqual([])
  })

  it('reports missing ZIP entries and checksum mismatches individually', async () => {
    const missing = {
      sourceId: 'document-missing',
      fileName: 'missing.txt',
      contentType: 'text/plain',
      width: null,
      height: null,
      path: 'documents/_orphans/document-missing__missing.txt',
      status: 'INCLUDED',
      sizeBytes: 3,
      sha256: '0'.repeat(64),
    }
    const result = await inspectSpliitCloudBundle(
      await bundleWithDocument(missing, new TextEncoder().encode('other')),
    )
    expect(result.kind).toBe('GROUP')
    if (result.kind !== 'GROUP') throw new Error('Expected a group bundle')
    expect(result.documents.size).toBe(0)
    expect(result.documentIssues[0]?.sourceId).toBe('document-missing')
  })

  it('rejects unsafe document paths and accepts missing documents only with null paths', async () => {
    const unsafe = {
      sourceId: 'document-unsafe',
      fileName: 'receipt.txt',
      contentType: 'text/plain',
      width: null,
      height: null,
      path: '../receipt.txt',
      status: 'INCLUDED',
      sizeBytes: 0,
      sha256: '0'.repeat(64),
    }
    const unsafeResult = await inspectSpliitCloudBundle(
      await bundleWithDocument(unsafe, new Uint8Array()),
    )
    expect(unsafeResult.kind).toBe('GROUP')
    if (unsafeResult.kind !== 'GROUP')
      throw new Error('Expected a group bundle')
    expect(unsafeResult.documentIssues[0]?.message).toMatch(/invalid/i)

    const missingResult = await inspectSpliitCloudBundle(
      new Blob([
        zipSync({
          'manifest.json': new TextEncoder().encode(
            JSON.stringify(
              manifest({
                orphanDocuments: [
                  {
                    sourceId: 'document-missing',
                    fileName: 'missing.txt',
                    contentType: 'text/plain',
                    width: null,
                    height: null,
                    path: null,
                    status: 'MISSING',
                    sizeBytes: null,
                    sha256: null,
                  },
                ],
              }),
            ),
          ),
        }),
      ]),
    )
    expect(missingResult.kind).toBe('GROUP')
    if (missingResult.kind !== 'GROUP')
      throw new Error('Expected a group bundle')
    expect(missingResult.documentIssues[0]?.sourceId).toBe('document-missing')
  })
})
