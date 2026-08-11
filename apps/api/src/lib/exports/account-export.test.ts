import { unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import {
  spliitAccountExportManifestSchema,
  spliitGroupExportManifestSchema,
} from '@spliit/domain/export-manifest'

import { createAccountExportArtifact } from './account-export'
import type { AccountExportSource } from './account-snapshot'
import type { ExportDocumentReader, ExportDocumentRecord } from './types'

const EXPORTED_AT = new Date('2026-08-10T12:00:00.000Z')

function makeDocument(): ExportDocumentRecord {
  return {
    id: 'doc-1',
    url: 'https://uploads.example.com/documents/doc-1/receipt.pdf',
    fileName: 'receipt.pdf',
    contentType: 'application/pdf',
    width: null,
    height: null,
  }
}

function makeGroup(document: ExportDocumentRecord | null = null) {
  const createdAt = new Date('2026-08-01T12:00:00.000Z')
  return {
    id: 'grp-1',
    name: 'Trip to Paris',
    information: 'Shared holiday costs',
    archived: false,
    groupType: 'GROUP' as const,
    subgroupsEnabled: false,
    createdAt,
    ledgerId: 'ledger-1',
    ledger: {
      id: 'ledger-1',
      currency: '€',
      currencyCode: 'EUR',
      createdAt,
      participants: [],
      recurringExpenseSeries: [],
      documents: document ? [] : [],
      expenses: document
        ? [
            {
              id: 'exp-1',
              createdAt,
              expenseDate: createdAt,
              title: 'Dinner',
              categoryId: 'dining-out',
              amount: 4200,
              originalAmount: null,
              originalCurrency: null,
              conversionRate: null,
              conversionSource: null,
              paidBySplitMode: 'BY_AMOUNT' as const,
              isReimbursement: false,
              splitMode: 'EVENLY' as const,
              version: 1,
              createdByAccountId: null,
              recurringSeriesId: null,
              recurrenceSequence: null,
              notes: null,
              paidByList: [],
              paidFor: [],
              documents: [document],
              comments: [],
              recurringSeries: null,
              items: [],
              itemizedRemainder: null,
            },
          ]
        : [],
    },
    subgroups: [],
    budgets: [],
  }
}

function makeSource(group: ReturnType<typeof makeGroup>): AccountExportSource {
  return {
    account: {
      id: 'acct-1',
      name: 'Alice',
      email: 'alice@example.com',
      preference: null,
    },
    notificationPreferences: [],
    groups: [
      {
        source: group as never,
        preference: {
          starred: true,
          hidden: false,
          defaultSplit: null,
        },
      },
    ],
  }
}

async function readArchive(
  artifact: ReturnType<typeof createAccountExportArtifact>,
) {
  const archive = unzipSync(
    new Uint8Array(await new Response(artifact.body).arrayBuffer()),
  )
  const readJson = (path: string) =>
    JSON.parse(new TextDecoder().decode(archive[path]))
  return {
    archive,
    root: readJson('manifest.json'),
    group: readJson('groups/grp-1/manifest.json'),
  }
}

describe('createAccountExportArtifact', () => {
  it('writes an authoritative account manifest and reusable prefixed group slice', async () => {
    const reader: ExportDocumentReader = {
      read: vi.fn(async () => new TextEncoder().encode('PDF')),
    }
    const artifact = createAccountExportArtifact(
      makeSource(makeGroup(makeDocument())),
      {
        exportedAt: EXPORTED_AT,
        documentReader: reader,
        includeDocuments: true,
        includeAccountPreferences: true,
        includeGroupPreferences: true,
      },
    )

    expect(artifact).toMatchObject({
      fileName: 'Spliit Cloud Account Export - 2026-08-10T12-00-00Z.spliit.zip',
      mediaType: 'application/zip',
      scope: { type: 'ACCOUNT', sourceId: 'acct-1' },
    })

    const { archive, root, group } = await readArchive(artifact)
    expect(
      archive['groups/grp-1/documents/exp-1/doc-1__receipt.pdf'],
    ).toBeDefined()
    expect(root).toMatchObject({
      format: 'spliit.cloud/export',
      scope: { type: 'ACCOUNT', sourceId: 'acct-1' },
      contents: {
        documents: true,
        accountPreferences: true,
        groupPreferences: true,
      },
      groups: [
        {
          sourceId: 'grp-1',
          manifestPath: 'groups/grp-1/manifest.json',
          complete: true,
        },
      ],
    })
    expect(group).toMatchObject({
      scope: { type: 'GROUP', sourceId: 'grp-1' },
      expenses: [
        {
          documents: [
            {
              status: 'INCLUDED',
              path: 'groups/grp-1/documents/exp-1/doc-1__receipt.pdf',
            },
          ],
        },
      ],
    })
    expect(spliitAccountExportManifestSchema.parse(root)).toEqual(root)
    expect(spliitGroupExportManifestSchema.parse(group)).toEqual(group)
    expect(reader.read).toHaveBeenCalledOnce()
  })

  it('marks documents as omitted when the selection excludes document bytes', async () => {
    const reader: ExportDocumentReader = {
      read: vi.fn(),
    }
    const { archive, group, root } = await readArchive(
      createAccountExportArtifact(makeSource(makeGroup(makeDocument())), {
        exportedAt: EXPORTED_AT,
        documentReader: reader,
        includeDocuments: false,
        includeAccountPreferences: false,
        includeGroupPreferences: false,
      }),
    )

    expect(
      archive['groups/grp-1/documents/exp-1/doc-1__receipt.pdf'],
    ).toBeUndefined()
    expect(group.expenses[0].documents[0]).toMatchObject({
      status: 'OMITTED',
      path: null,
      sizeBytes: null,
      sha256: null,
    })
    expect(root.contents).toEqual({
      documents: false,
      accountPreferences: false,
      groupPreferences: false,
    })
    expect(reader.read).not.toHaveBeenCalled()
  })

  it('records missing document warnings at both account and group scope', async () => {
    const { root, group } = await readArchive(
      createAccountExportArtifact(makeSource(makeGroup(makeDocument())), {
        exportedAt: EXPORTED_AT,
        documentReader: {
          read: vi.fn(async () => {
            throw new Error('Not found')
          }),
        },
        includeDocuments: true,
        includeAccountPreferences: true,
        includeGroupPreferences: true,
      }),
    )

    expect(group).toMatchObject({
      complete: false,
      warnings: [
        {
          type: 'MISSING_DOCUMENT',
          documentId: 'doc-1',
          path: 'groups/grp-1/documents/exp-1/doc-1__receipt.pdf',
        },
      ],
    })
    expect(root).toMatchObject({
      complete: false,
      warnings: [
        {
          type: 'MISSING_DOCUMENT',
          groupSourceId: 'grp-1',
          documentId: 'doc-1',
          path: 'groups/grp-1/documents/exp-1/doc-1__receipt.pdf',
        },
      ],
    })
  })

  it('omits synthetic placeholder emails from the portable identity directory', async () => {
    const source = makeSource(makeGroup())
    source.account.email = 'provider-id@github.placeholder.local'
    const { root } = await readArchive(
      createAccountExportArtifact(source, {
        exportedAt: EXPORTED_AT,
        documentReader: { read: vi.fn() },
        includeDocuments: false,
        includeAccountPreferences: true,
        includeGroupPreferences: false,
      }),
    )

    expect(root.account.email).toBeNull()
    expect(root.identities).toEqual([
      { sourceId: 'acct-1', name: 'Alice', email: null },
    ])
  })
})
