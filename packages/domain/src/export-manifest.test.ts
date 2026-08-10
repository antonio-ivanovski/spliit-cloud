import { describe, expect, it } from 'vitest'

import {
  spliitGroupExportManifestSchema,
  spliitGroupExportSnapshotSchema,
} from './export-manifest'

const minimalManifest = {
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
  participants: [],
  subgroups: [],
  budgets: [],
  recurrenceSeries: [],
  expenses: [],
  orphanDocuments: [],
}

describe('spliitGroupExportManifestSchema', () => {
  it('accepts the versioned native group envelope', () => {
    expect(spliitGroupExportManifestSchema.parse(minimalManifest)).toEqual(
      minimalManifest,
    )
  })

  it('exposes the group data as a reusable container-independent snapshot', () => {
    const {
      format: _format,
      version: _version,
      scope: _scope,
      exportedAt: _exportedAt,
      ...snapshot
    } = minimalManifest

    expect(spliitGroupExportSnapshotSchema.parse(snapshot)).toEqual(snapshot)
  })

  it('rejects unsupported versions and invalid document checksums', () => {
    expect(() =>
      spliitGroupExportManifestSchema.parse({
        ...minimalManifest,
        version: 2,
      }),
    ).toThrow()

    expect(() =>
      spliitGroupExportManifestSchema.parse({
        ...minimalManifest,
        orphanDocuments: [
          {
            sourceId: 'doc-1',
            fileName: 'receipt.pdf',
            contentType: 'application/pdf',
            width: null,
            height: null,
            path: 'documents/_orphans/doc-1__receipt.pdf',
            status: 'INCLUDED',
            sizeBytes: 3,
            sha256: 'not-a-checksum',
          },
        ],
      }),
    ).toThrow()
  })
})
