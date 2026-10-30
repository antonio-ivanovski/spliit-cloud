import { unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import {
  personalExportManifestSchema,
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
              expenseTimeZone: 'UTC',
              title: 'Dinner',
              categoryId: 'dining-out',
              amount: 4200,
              originalAmount: null,
              originalCurrency: null,
              conversionRate: null,
              conversionSource: null,
              paidBySplitMode: 'BY_AMOUNT' as const,
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

function makeSource(
  group: ReturnType<typeof makeGroup>,
  personal: AccountExportSource['personal'] = null,
): AccountExportSource {
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
        },
      },
    ],
    personal,
  }
}

function makePersonal(): NonNullable<AccountExportSource['personal']> {
  const at = new Date('2026-08-10T12:00:00.000Z')
  return {
    profile: {
      currencyCode: 'USD',
      timeZone: 'UTC',
      sharedEnabled: true,
      createdAt: at,
      updatedAt: at,
    },
    transactions: [
      {
        id: 'ptx-1',
        kind: 'EXPENSE',
        amount: 4200,
        currencyCode: 'USD',
        originalAmount: 4200,
        originalCurrency: 'USD',
        conversionRate: null,
        conversionSource: null,
        date: new Date('2026-08-10T00:00:00.000Z'),
        categoryId: 'groceries',
        title: 'Market',
        note: null,
        version: 1,
        source: 'PERSONAL',
        sourceExpenseId: null,
        sourceGroupId: null,
        sourceGroupName: null,
        sourceDetachedAt: null,
        personalRecurringSeriesId: null,
        recurrenceSequence: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'ptx-2',
        kind: 'EXPENSE',
        amount: 5000,
        currencyCode: 'USD',
        originalAmount: 5000,
        originalCurrency: 'EUR',
        conversionRate: 1.1,
        conversionSource: 'EXCHANGE',
        date: new Date('2026-08-09T00:00:00.000Z'),
        categoryId: 'dining-out',
        title: 'Dinner share',
        note: null,
        version: 2,
        source: 'GROUP',
        sourceExpenseId: 'exp-9',
        sourceGroupId: 'grp-1',
        sourceGroupName: 'Trip to Paris',
        sourceDetachedAt: null,
        personalRecurringSeriesId: null,
        recurrenceSequence: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    budgets: [
      {
        id: 'bud-1',
        name: 'Food',
        amount: 5000,
        currencyCode: 'USD',
        period: 'MONTHLY',
        timeZone: 'UTC',
        categoryScope: 'ALL',
        categoryIds: [],
        startDay: 1,
        archived: false,
        archivedAt: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    rules: [
      {
        id: 'rule-1',
        groupId: 'grp-1',
        included: true,
        includeFrom: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    overrides: [
      {
        id: 'ovr-1',
        expenseId: 'exp-9',
        state: null,
        categoryId: 'dining-out',
        createdAt: at,
        updatedAt: at,
      },
    ],
    importSources: [
      {
        personalTransactionId: 'ptx-1',
        provider: 'GENERIC_CSV',
        importKey: 'key-1',
        externalIdentityHash: null,
        semanticHash: 'sem-1',
        rawHash: 'raw-1',
        importedByAccountId: 'acct-1',
        createdAt: at,
      },
    ],
    recurringSeries: [
      {
        id: 'series-1',
        timeZone: 'UTC',
        frequency: 'MONTHLY',
        interval: 1,
        anchorDate: new Date('2026-08-01T00:00:00.000Z'),
        anchorSequence: 1,
        nextOccurrenceDate: new Date('2026-09-01T00:00:00.000Z'),
        nextOccurrenceOrdinal: 2,
        endType: 'INDEFINITE',
        occurrenceLimit: null,
        endDate: null,
        occurrencesCreated: 1,
        status: 'ACTIVE',
        kind: 'EXPENSE',
        amount: 1000,
        currencyCode: 'USD',
        categoryId: 'general',
        title: 'Rent share',
        note: null,
        version: 1,
        createdAt: at,
        updatedAt: at,
      },
    ],
    attachments: [
      {
        id: 'pdoc-1',
        personalTransactionId: 'ptx-1',
        url: 'https://uploads.example.com/documents/pdoc-1/receipt.jpg',
        fileName: 'receipt.jpg',
        contentType: 'image/jpeg',
        width: 800,
        height: 600,
      },
    ],
  }
}

async function readPersonal(
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
    personal: readJson('personal/manifest.json'),
    transactions: readJson('personal/transactions.json'),
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
    expect(group.expenses[0]).not.toHaveProperty('isReimbursement')
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
      personal: false,
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

  it('writes a personal-only slice with nested manifest and transactions', async () => {
    const reader: ExportDocumentReader = {
      read: vi.fn(async () => new TextEncoder().encode('JPEG')),
    }
    const source: AccountExportSource = {
      account: {
        id: 'acct-1',
        name: 'Alice',
        email: 'alice@example.com',
        preference: null,
      },
      notificationPreferences: [],
      groups: [],
      personal: makePersonal(),
    }
    const { archive, root, personal, transactions } = await readPersonal(
      createAccountExportArtifact(source, {
        exportedAt: EXPORTED_AT,
        documentReader: reader,
        includeDocuments: true,
        includeAccountPreferences: false,
        includeGroupPreferences: false,
        includePersonal: true,
      }),
    )

    expect(root.contents.personal).toBe(true)
    expect(root.personal).toMatchObject({
      manifestPath: 'personal/manifest.json',
      transactionCount: 2,
      budgetCount: 1,
      ruleCount: 1,
      overrideCount: 1,
      recurringCount: 1,
      attachmentCount: 1,
      warningCount: 0,
      complete: true,
    })
    expect(personal).toMatchObject({
      transactionsPath: 'personal/transactions.json',
      transactionCount: 2,
      complete: true,
      counts: {
        transactions: 2,
        budgets: 1,
        rules: 1,
        overrides: 1,
        importSources: 1,
        recurringSeries: 1,
        attachments: 1,
      },
    })
    // Provenance survives: group link, version, and recurring series.
    expect(transactions).toHaveLength(2)
    expect(transactions[0]).toMatchObject({
      sourceId: 'ptx-1',
      source: 'PERSONAL',
      version: 1,
    })
    expect(transactions[1]).toMatchObject({
      sourceId: 'ptx-2',
      source: 'GROUP',
      sourceExpenseId: 'exp-9',
      sourceGroupId: 'grp-1',
      sourceGroupName: 'Trip to Paris',
    })
    // Import source allow-list excludes unbounded meta.
    expect(personal.importSources[0]).not.toHaveProperty('meta')
    expect(personal.attachments[0]).toMatchObject({
      sourceId: 'pdoc-1',
      transactionSourceId: 'ptx-1',
      status: 'INCLUDED',
      path: 'personal/documents/pdoc-1__receipt.jpg',
    })
    expect(archive['personal/documents/pdoc-1__receipt.jpg']).toBeDefined()
    expect(archive['personal/transactions.json']).toBeDefined()
    expect(spliitAccountExportManifestSchema.parse(root)).toEqual(root)
    expect(personalExportManifestSchema.parse(personal)).toEqual(personal)
    expect(reader.read).toHaveBeenCalledOnce()
  })

  it('omits personal attachment bytes without claiming completeness', async () => {
    const { root, personal, archive } = await readPersonal(
      createAccountExportArtifact(
        {
          account: {
            id: 'acct-1',
            name: 'Alice',
            email: 'alice@example.com',
            preference: null,
          },
          notificationPreferences: [],
          groups: [],
          personal: makePersonal(),
        },
        {
          exportedAt: EXPORTED_AT,
          documentReader: { read: vi.fn() },
          includeDocuments: false,
          includeAccountPreferences: false,
          includeGroupPreferences: false,
          includePersonal: true,
        },
      ),
    )
    expect(personal.attachments[0]).toMatchObject({
      status: 'OMITTED',
      path: null,
    })
    expect(personal.complete).toBe(true)
    expect(root.personal?.complete).toBe(true)
    expect(archive['personal/documents/pdoc-1__receipt.jpg']).toBeUndefined()
  })

  it('marks missing personal documents in the nested manifest and root completeness', async () => {
    const { root, personal } = await readPersonal(
      createAccountExportArtifact(
        {
          account: {
            id: 'acct-1',
            name: 'Alice',
            email: 'alice@example.com',
            preference: null,
          },
          notificationPreferences: [],
          groups: [],
          personal: makePersonal(),
        },
        {
          exportedAt: EXPORTED_AT,
          documentReader: {
            read: vi.fn(async () => {
              throw new Error('Not found')
            }),
          },
          includeDocuments: true,
          includeAccountPreferences: false,
          includeGroupPreferences: false,
          includePersonal: true,
        },
      ),
    )
    expect(personal.complete).toBe(false)
    expect(personal.warnings).toEqual([
      {
        type: 'MISSING_DOCUMENT',
        documentId: 'pdoc-1',
        path: 'personal/documents/pdoc-1__receipt.jpg',
      },
    ])
    expect(root.complete).toBe(false)
    expect(root.personal?.complete).toBe(false)
    expect(root.personal?.warningCount).toBe(1)
    // Root warnings stay group-scoped so old readers keep validating.
    expect(root.warnings).toEqual([])
  })

  it('excludes the personal slice entirely when includePersonal is false', async () => {
    const artifact = createAccountExportArtifact(
      {
        account: {
          id: 'acct-1',
          name: 'Alice',
          email: 'alice@example.com',
          preference: null,
        },
        notificationPreferences: [],
        groups: [],
        personal: makePersonal(),
      },
      {
        exportedAt: EXPORTED_AT,
        documentReader: { read: vi.fn() },
        includeDocuments: true,
        includeAccountPreferences: false,
        includeGroupPreferences: false,
        includePersonal: false,
      },
    )
    const archive = unzipSync(
      new Uint8Array(await new Response(artifact.body).arrayBuffer()),
    )
    const root = JSON.parse(new TextDecoder().decode(archive['manifest.json']))
    expect(root.contents.personal).toBe(false)
    expect(root.personal).toBeNull()
    expect(archive['personal/manifest.json']).toBeUndefined()
    expect(archive['personal/transactions.json']).toBeUndefined()
  })

  it('never duplicates group documents into the personal slice', async () => {
    const reader: ExportDocumentReader = {
      read: vi.fn(async () => new TextEncoder().encode('PDF')),
    }
    const { archive } = await readPersonal(
      createAccountExportArtifact(
        makeSource(makeGroup(makeDocument()), makePersonal()),
        {
          exportedAt: EXPORTED_AT,
          documentReader: reader,
          includeDocuments: true,
          includeAccountPreferences: false,
          includeGroupPreferences: false,
          includePersonal: true,
        },
      ),
    )
    expect(
      archive['groups/grp-1/documents/exp-1/doc-1__receipt.pdf'],
    ).toBeDefined()
    expect(archive['personal/documents/pdoc-1__receipt.jpg']).toBeDefined()
    // 1 group document + 1 personal document, no cross-posting.
    expect(reader.read).toHaveBeenCalledTimes(2)
  })
})
