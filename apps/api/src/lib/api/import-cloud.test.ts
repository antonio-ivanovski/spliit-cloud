import { describe, expect, it, vi } from 'vitest'

import {
  importCloudGroup,
  prepareCloudImport,
  type CloudImportInput,
} from './import-cloud'

const manifest = {
  format: 'spliit.cloud/export' as const,
  version: 1 as const,
  scope: { type: 'GROUP' as const, sourceId: 'group-1' },
  exportedAt: '2026-08-10T12:00:00.000Z',
  complete: true,
  warnings: [],
  group: {
    sourceId: 'group-1',
    name: 'Trip',
    information: null,
    archived: false,
    groupType: 'GROUP' as const,
    subgroupsEnabled: false,
    createdAt: '2026-08-01T12:00:00.000Z',
    ledger: {
      sourceId: 'ledger-1',
      currency: '$',
      currencyCode: 'USD',
      createdAt: '2026-08-01T12:00:00.000Z',
    },
  },
  participants: [
    {
      sourceId: 'participant-1',
      kind: 'UNLINKED_PARTICIPANT' as const,
      displayName: 'Alex',
      removedAt: null,
      membership: null,
    },
  ],
  subgroups: [],
  budgets: [],
  recurrenceSeries: [],
  expenses: [],
  orphanDocuments: [],
}

function input(overrides: Partial<CloudImportInput> = {}): CloudImportInput {
  return {
    manifest,
    groupFormValues: {
      name: 'Trip copy',
      information: null,
      currency: '$',
      currencyCode: 'USD',
    },
    archived: false,
    participants: [
      {
        sourceParticipantId: 'participant-1',
        sourceName: 'Alex',
        mode: 'UNLINKED_PARTICIPANT',
      },
    ],
    stagedDocuments: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      documents: [],
    },
    skippedDocumentIds: [],
    acknowledgedIssues: false,
    ...overrides,
  }
}

describe('prepareCloudImport', () => {
  it('accepts a complete document-free group snapshot', async () => {
    const prepared = await prepareCloudImport(input(), 'account-1')
    expect(prepared.documents.size).toBe(0)
    expect(prepared.promotedDocumentUrls).toEqual([])
  })

  it('requires the source currency and participant mappings to remain intact', async () => {
    await expect(
      prepareCloudImport(
        input({
          groupFormValues: {
            name: 'Trip copy',
            information: null,
            currency: '€',
            currencyCode: 'EUR',
          },
        }),
        'account-1',
      ),
    ).rejects.toThrow(/currency/i)

    await expect(
      prepareCloudImport(input({ participants: [] }), 'account-1'),
    ).rejects.toThrow(/participant/i)
  })

  it('accepts a document-free restore after every included document is acknowledged as skipped', async () => {
    const document = {
      sourceId: 'document-1',
      fileName: 'receipt.jpg',
      contentType: 'image/jpeg',
      width: null,
      height: null,
      path: 'documents/expense-1/document-1__receipt.jpg',
      status: 'INCLUDED' as const,
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
    }
    const withDocument = {
      ...manifest,
      orphanDocuments: [document],
    }

    await expect(
      prepareCloudImport(input({ manifest: withDocument }), 'account-1'),
    ).rejects.toThrow(/every included document must be staged/i)

    const prepared = await prepareCloudImport(
      input({
        manifest: withDocument,
        skippedDocumentIds: ['document-1'],
        acknowledgedIssues: true,
      }),
      'account-1',
    )
    expect(prepared.documents.size).toBe(0)
    expect(prepared.promotedDocumentUrls).toEqual([])
  })

  it('restores through a transaction client with fresh ids and archives after contents', async () => {
    const calls: string[] = []
    const tx = {
      ledger: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          calls.push('ledger.create')
          return { id: data.id, currencyCode: 'USD' }
        }),
      },
      group: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          calls.push('group.create')
          return { id: data.id }
        }),
        update: vi.fn(async () => {
          calls.push('group.update')
          return {}
        }),
      },
      groupMember: {
        create: vi.fn(async () => {
          calls.push('groupMember.create')
          return { id: 'member-1' }
        }),
      },
      ledgerParticipant: {
        create: vi.fn(async ({ data }: { data: { id?: string } }) => {
          calls.push('ledgerParticipant.create')
          return { id: data.id ?? 'actor-participant' }
        }),
      },
      accountGroupPreference: {
        upsert: vi.fn(async () => ({ id: 'group-pref-1' })),
      },
      accountGroupDefaultSplit: {
        upsert: vi.fn(async () => ({ id: 'default-split-1' })),
      },
      accountGroupDefaultSplitPaidFor: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      activity: {
        create: vi.fn(async () => {
          calls.push('activity.create')
          return { id: 'activity-1' }
        }),
      },
    }

    const result = await importCloudGroup(
      input({ archived: true }),
      { accountId: 'account-1' },
      {
        tx: tx as never,
        prepared: { documents: new Map(), promotedDocumentUrls: [] },
      },
    )

    expect(result.sourceGroupId).toBe('group-1')
    expect(result.groupId).not.toBe('group-1')
    expect(calls.indexOf('group.update')).toBeGreaterThan(
      calls.indexOf('ledgerParticipant.create'),
    )
    expect(calls.at(-1)).toBe('activity.create')
  })

  it('restores account group preferences with remapped participant ids', async () => {
    const tx = {
      ledger: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
          currencyCode: 'USD',
        })),
      },
      group: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
        })),
        update: vi.fn(async () => ({})),
      },
      groupMember: { create: vi.fn(async () => ({ id: 'member-1' })) },
      ledgerParticipant: {
        create: vi.fn(async ({ data }: { data: { id?: string } }) => ({
          id: data.id ?? 'actor-participant',
        })),
      },
      accountGroupPreference: {
        upsert: vi.fn(async () => ({ id: 'group-pref-1' })),
      },
      accountGroupDefaultSplit: {
        upsert: vi.fn(async () => ({ id: 'default-split-1' })),
      },
      accountGroupDefaultSplitPaidFor: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      activity: { create: vi.fn(async () => ({ id: 'activity-1' })) },
    }

    await importCloudGroup(
      input({
        groupPreference: {
          starred: true,
          hidden: false,
          defaultSplit: {
            splitMode: 'EVENLY',
            paidFor: [{ participantId: 'participant-1', shares: 100 }],
          },
        },
      }),
      { accountId: 'account-1' },
      {
        tx: tx as never,
        prepared: { documents: new Map(), promotedDocumentUrls: [] },
      },
    )

    expect(tx.accountGroupPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ starred: true, hidden: false }),
      }),
    )
    expect(tx.accountGroupDefaultSplitPaidFor.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ participantId: expect.any(String) })],
      }),
    )
    expect(
      tx.accountGroupDefaultSplitPaidFor.createMany.mock.calls[0]?.[0].data[0]
        .participantId,
    ).not.toBe('participant-1')
  })
})
