import { unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import { createExportBundleStream } from './archive'
import { createGroupExportArtifact } from './group-export'
import {
  createGroupExportSnapshot,
  type GroupExportSource,
} from './group-snapshot'
import type { ExportDocumentReader, ExportDocumentRecord } from './types'

const EXPORTED_AT = new Date('2026-08-10T12:00:00.000Z')

function makeDocument(
  overrides: Partial<ExportDocumentRecord> = {},
): ExportDocumentRecord {
  return {
    id: 'doc-1',
    url: 'https://uploads.example.com/documents/doc-1/receipt.pdf',
    fileName: '../receipt.pdf',
    contentType: 'application/pdf',
    width: null,
    height: null,
    ...overrides,
  }
}

function makeExpense(document: ExportDocumentRecord) {
  const earlier = new Date('2026-08-08T12:00:00.000Z')
  return {
    id: 'exp-1',
    createdAt: earlier,
    expenseDate: earlier,
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
    notes: 'Receipt attached',
    paidByList: [
      { ledgerParticipantId: 'lp-b', shares: 2100 },
      { ledgerParticipantId: 'lp-a', shares: 2100 },
    ],
    paidFor: [
      { ledgerParticipantId: 'lp-b', shares: 100 },
      { ledgerParticipantId: 'lp-a', shares: 100 },
    ],
    documents: [document],
    comments: [
      {
        id: 'comment-b',
        authorName: 'Bob',
        text: 'Later',
        createdAt: new Date('2026-08-08T14:00:00.000Z'),
      },
      {
        id: 'comment-a',
        authorName: 'Alice',
        text: 'Earlier',
        createdAt: new Date('2026-08-08T13:00:00.000Z'),
      },
    ],
    recurringSeries: null,
    items: [],
    itemizedRemainder: null,
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
      participants: [
        {
          id: 'lp-b',
          kind: 'UNLINKED_PARTICIPANT' as const,
          displayName: 'Bob',
          removedAt: null,
          groupMemberId: null,
          ledgerId: 'ledger-1',
          groupMember: null,
          invitations: [],
        },
        {
          id: 'lp-a',
          kind: 'UNLINKED_PARTICIPANT' as const,
          displayName: 'Alice',
          removedAt: null,
          groupMemberId: null,
          ledgerId: 'ledger-1',
          groupMember: null,
          invitations: [],
        },
      ],
      recurringExpenseSeries: [],
      documents: document ? [document] : [],
      expenses: document ? [makeExpense(document)] : [],
    },
    subgroups: [],
    budgets: [],
  } as unknown as GroupExportSource
}

function documentReader(bytes = 'PDF'): ExportDocumentReader {
  return {
    read: vi.fn(async () => new TextEncoder().encode(bytes)),
  }
}

async function readArtifact(
  artifact: ReturnType<typeof createGroupExportArtifact>,
) {
  const archive = unzipSync(
    new Uint8Array(await new Response(artifact.body).arrayBuffer()),
  )
  const manifestText = new TextDecoder().decode(archive['manifest.json'])
  return { archive, manifestText, manifest: JSON.parse(manifestText) }
}

describe('createGroupExportArtifact', () => {
  it('namespaces reusable descriptors and the manifest for a group slice', async () => {
    const entry = {
      sourceId: 'doc-1',
      fileName: 'receipt.txt',
      contentType: 'text/plain',
      width: null,
      height: null,
      path: 'documents/exp-1/doc-1__receipt.txt',
      status: 'MISSING' as const,
      sizeBytes: null,
      sha256: null,
    }
    const body = createExportBundleStream({
      manifest: { documents: [entry] },
      documents: [
        {
          record: makeDocument(),
          entry,
          markMissing: vi.fn(),
        },
      ],
      documentReader: documentReader('TXT'),
      archivePrefix: 'groups/grp-1',
      validateManifest: (value) => value,
    })
    const archive = unzipSync(
      new Uint8Array(await new Response(body).arrayBuffer()),
    )
    expect(
      archive['groups/grp-1/documents/exp-1/doc-1__receipt.txt'],
    ).toBeDefined()
    expect(archive['groups/grp-1/manifest.json']).toBeDefined()
    expect(archive['manifest.json']).toBeUndefined()
    expect(entry.path).toBe('groups/grp-1/documents/exp-1/doc-1__receipt.txt')
  })

  it('creates the existing v1 bundle without depending on HTTP transport', async () => {
    const document = makeDocument()
    const reader = documentReader()
    const artifact = createGroupExportArtifact(makeGroup(document), {
      exportedAt: EXPORTED_AT,
      documentReader: reader,
    })

    expect(artifact).toMatchObject({
      fileName: 'Spliit Cloud Export - Trip to Paris - 2026-08-10.spliit.zip',
      mediaType: 'application/zip',
      scope: { type: 'GROUP', sourceId: 'grp-1' },
      exportedAt: EXPORTED_AT.toISOString(),
    })

    const { archive, manifest } = await readArtifact(artifact)
    const path = 'documents/exp-1/doc-1__receipt.pdf'
    expect(new TextDecoder().decode(archive[path])).toBe('PDF')
    expect(manifest).toMatchObject({
      format: 'spliit.cloud/export',
      version: 1,
      scope: { type: 'GROUP', sourceId: 'grp-1' },
      exportedAt: EXPORTED_AT.toISOString(),
      complete: true,
    })
    expect(manifest.expenses[0].documents[0]).toMatchObject({
      status: 'INCLUDED',
      path,
      sizeBytes: 3,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    for (const exportedDocument of [
      ...manifest.expenses.flatMap(
        (expense: {
          documents: Array<{ status: string; path: string | null }>
        }) => expense.documents,
      ),
      ...manifest.orphanDocuments,
    ]) {
      if (exportedDocument.status !== 'INCLUDED') continue
      const entryPath = exportedDocument.path
      expect(entryPath).toBeTruthy()
      if (!entryPath) throw new Error('Included document has no archive path')
      expect(archive[entryPath]).toBeDefined()
    }
    expect(reader.read).toHaveBeenCalledWith(document, expect.any(AbortSignal))
  })

  it('lets an account assembler namespace snapshot document descriptors', () => {
    const { snapshot, documents } = createGroupExportSnapshot(
      makeGroup(makeDocument()),
      {
        archivePrefix: 'groups/grp-1',
      },
    )

    const path = 'groups/grp-1/documents/exp-1/doc-1__receipt.pdf'
    expect(snapshot.expenses[0].documents[0].path).toBe(path)
    expect(documents[0].entry.path).toBe(path)
    expect(documents[0].entry).toBe(snapshot.expenses[0].documents[0])
  })

  it('keeps unattached documents in the explicit orphan namespace', async () => {
    const document = makeDocument()
    const group = makeGroup(document)
    group.ledger.expenses = []
    const artifact = createGroupExportArtifact(group, {
      exportedAt: EXPORTED_AT,
      documentReader: documentReader(),
    })

    const { archive, manifest } = await readArtifact(artifact)
    const path = 'documents/_orphans/doc-1__receipt.pdf'
    expect(archive[path]).toBeDefined()
    expect(manifest.orphanDocuments[0]).toMatchObject({
      sourceId: 'doc-1',
      status: 'INCLUDED',
      path,
    })
  })

  it('records missing documents without leaving a false archive link', async () => {
    const artifact = createGroupExportArtifact(makeGroup(makeDocument()), {
      exportedAt: EXPORTED_AT,
      documentReader: {
        read: vi.fn(async () => {
          throw new Error('Not found')
        }),
      },
    })

    const { archive, manifest } = await readArtifact(artifact)
    expect(Object.keys(archive)).toEqual(['manifest.json'])
    expect(manifest.complete).toBe(false)
    expect(manifest.expenses[0].documents[0]).toMatchObject({
      status: 'MISSING',
      path: null,
      sizeBytes: null,
      sha256: null,
    })
    expect(manifest.warnings).toEqual([
      {
        type: 'MISSING_DOCUMENT',
        documentId: 'doc-1',
        path: 'documents/exp-1/doc-1__receipt.pdf',
      },
    ])
  })

  it('sorts portable collections deterministically and uses one injected clock', async () => {
    const first = await readArtifact(
      createGroupExportArtifact(makeGroup(makeDocument()), {
        exportedAt: EXPORTED_AT,
        documentReader: documentReader(),
      }),
    )
    const second = await readArtifact(
      createGroupExportArtifact(makeGroup(makeDocument()), {
        exportedAt: EXPORTED_AT,
        documentReader: documentReader(),
      }),
    )

    expect(first.manifestText).toBe(second.manifestText)
    expect(
      first.manifest.participants.map(
        (value: { sourceId: string }) => value.sourceId,
      ),
    ).toEqual(['lp-a', 'lp-b'])
    expect(first.manifest.expenses[0].paidByList).toEqual([
      { participantId: 'lp-a', shares: 2100 },
      { participantId: 'lp-b', shares: 2100 },
    ])
    expect(
      first.manifest.expenses[0].comments.map(
        (value: { sourceId: string }) => value.sourceId,
      ),
    ).toEqual(['comment-a', 'comment-b'])
    expect(first.manifest.exportedAt).toBe(EXPORTED_AT.toISOString())
  })

  it('accepts deterministic extra entries for a future optional viewer', async () => {
    const artifact = createGroupExportArtifact(makeGroup(), {
      exportedAt: EXPORTED_AT,
      documentReader: documentReader(),
      additionalEntries: [
        {
          path: 'viewer/index.html',
          bytes: new TextEncoder().encode('<!doctype html>'),
        },
      ],
    })

    const { archive } = await readArtifact(artifact)
    expect(Object.keys(archive)).toEqual(['viewer/index.html', 'manifest.json'])
  })

  it.each(['../viewer.html', 'manifest.json'])(
    'rejects unsafe or reserved extra archive entry %s',
    async (path) => {
      const artifact = createGroupExportArtifact(makeGroup(), {
        exportedAt: EXPORTED_AT,
        documentReader: documentReader(),
        additionalEntries: [
          { path, bytes: new TextEncoder().encode('viewer') },
        ],
      })

      await expect(new Response(artifact.body).arrayBuffer()).rejects.toThrow(
        /Invalid|Duplicate/,
      )
    },
  )

  it('aborts an active document read when its consumer cancels', async () => {
    let readSignal: AbortSignal | undefined
    const artifact = createGroupExportArtifact(makeGroup(makeDocument()), {
      exportedAt: EXPORTED_AT,
      documentReader: {
        read: vi.fn(
          (_document, signal) =>
            new Promise((_resolve, reject) => {
              readSignal = signal
              signal.addEventListener(
                'abort',
                () => reject(new Error('aborted')),
                { once: true },
              )
            }),
        ),
      },
    })
    const reader = artifact.body.getReader()
    await new Promise((resolve) => setTimeout(resolve, 0))

    await reader.cancel()

    expect(readSignal?.aborted).toBe(true)
  })

  it('errors the artifact stream and aborts reads on an external signal', async () => {
    let readSignal: AbortSignal | undefined
    const controller = new AbortController()
    const artifact = createGroupExportArtifact(makeGroup(makeDocument()), {
      exportedAt: EXPORTED_AT,
      signal: controller.signal,
      documentReader: {
        read: vi.fn(
          (_document, signal) =>
            new Promise((_resolve, reject) => {
              readSignal = signal
              signal.addEventListener(
                'abort',
                () => reject(new Error('aborted')),
                { once: true },
              )
            }),
        ),
      },
    })
    const pendingRead = artifact.body.getReader().read()
    await new Promise((resolve) => setTimeout(resolve, 0))

    controller.abort(new Error('worker stopping'))

    await expect(pendingRead).rejects.toThrow('worker stopping')
    expect(readSignal?.aborted).toBe(true)
  })
})
