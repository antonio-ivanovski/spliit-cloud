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
    emoji: '🎉',
    color: '#a1b2c3',
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

  it('validates FRIEND ledgers as two-person restores with a connected peer', async () => {
    const friendManifest = {
      ...manifest,
      group: { ...manifest.group, groupType: 'FRIEND' as const },
      participants: [
        {
          sourceId: 'participant-1',
          kind: 'ACCOUNT_MEMBER' as const,
          displayName: 'Alice',
          identity: {
            kind: 'ACCOUNT' as const,
            accountId: 'account-1',
            name: 'Alice',
            email: 'alice@example.com',
          },
          removedAt: null,
          membership: null,
        },
        {
          sourceId: 'participant-2',
          kind: 'UNLINKED_PARTICIPANT' as const,
          displayName: 'Bob',
          removedAt: null,
          membership: null,
        },
      ],
    }
    const valid = input({
      manifest: friendManifest,
      participants: [
        {
          sourceParticipantId: 'participant-1',
          sourceName: 'Alice',
          mode: 'LINK_ACCOUNT',
          linkedAccountId: 'account-1',
        },
        {
          sourceParticipantId: 'participant-2',
          sourceName: 'Bob',
          mode: 'INVITE_BY_LINK',
        },
      ],
    })

    await expect(prepareCloudImport(valid, 'account-1')).resolves.toMatchObject(
      {
        documents: expect.any(Map),
      },
    )
    await expect(
      prepareCloudImport(
        input({
          manifest: friendManifest,
          participants: valid.participants.map((participant) =>
            participant.sourceParticipantId === 'participant-2'
              ? { ...participant, mode: 'UNLINKED_PARTICIPANT' as const }
              : participant,
          ),
        }),
        'account-1',
      ),
    ).rejects.toThrow(/contact, email, or link/i)
  })

  it('creates a FRIEND destination through the friend-ledger service', async () => {
    const friendManifest = {
      ...manifest,
      group: { ...manifest.group, groupType: 'FRIEND' as const },
      participants: [
        {
          sourceId: 'participant-1',
          kind: 'ACCOUNT_MEMBER' as const,
          displayName: 'Alice',
          removedAt: null,
          membership: null,
        },
        {
          sourceId: 'participant-2',
          kind: 'UNLINKED_PARTICIPANT' as const,
          displayName: 'Bob',
          removedAt: null,
          membership: null,
        },
      ],
    }
    const calls: Array<{ model: string; data?: Record<string, unknown> }> = []
    const tx = {
      account: { findUnique: vi.fn(async () => null) },
      ledger: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          calls.push({ model: 'ledger', data })
          return { id: data.id }
        }),
      },
      group: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          calls.push({ model: 'group', data })
          return { id: data.id }
        }),
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({ ledgerId: 'ledger-friend' })),
      },
      groupMember: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
        })),
      },
      ledgerParticipant: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
        })),
        findMany: vi.fn(async () => [
          {
            id: 'dest-alice',
            groupMember: { accountId: 'account-1' },
            invitations: [],
          },
          {
            id: 'dest-bob',
            groupMember: null,
            invitations: [{ type: 'LINK', email: 'link@placeholder.local' }],
          },
        ]),
      },
      groupInvitation: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
        })),
      },
      activity: { create: vi.fn(async () => ({ id: 'activity-1' })) },
    }
    const result = await importCloudGroup(
      input({
        manifest: friendManifest,
        participants: [
          {
            sourceParticipantId: 'participant-1',
            sourceName: 'Alice',
            mode: 'LINK_ACCOUNT',
            linkedAccountId: 'account-1',
          },
          {
            sourceParticipantId: 'participant-2',
            sourceName: 'Bob',
            mode: 'INVITE_BY_LINK',
          },
        ],
      }),
      { accountId: 'account-1' },
      {
        tx: tx as never,
        prepared: { documents: new Map(), promotedDocumentUrls: [] },
      },
    )

    expect(result.groupId).not.toBe('group-1')
    expect(calls.find((call) => call.model === 'group')?.data).toMatchObject({
      groupType: 'FRIEND',
    })
    expect(result.invites[0]?.kind).toBe('LINK')
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
    const participantIds: string[] = []
    const groupCreateData: Array<Record<string, unknown>> = []
    const tx = {
      ledger: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          calls.push('ledger.create')
          return { id: data.id, currencyCode: 'USD' }
        }),
      },
      group: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          calls.push('group.create')
          groupCreateData.push(data)
          return { id: data.id }
        }),
        update: vi.fn(async () => {
          calls.push('group.update')
          return {}
        }),
      },
      groupInvitation: { findFirst: vi.fn(async () => null) },
      groupMember: {
        create: vi.fn(async () => {
          calls.push('groupMember.create')
          return { id: 'member-1' }
        }),
      },
      ledgerParticipant: {
        create: vi.fn(async ({ data }: { data: { id?: string } }) => {
          calls.push('ledgerParticipant.create')
          const id = data.id ?? 'actor-participant'
          participantIds.push(id)
          return { id }
        }),
        findMany: vi.fn(async () => participantIds.map((id) => ({ id }))),
      },
      accountGroupPreference: {
        upsert: vi.fn(async () => ({ id: 'group-pref-1' })),
      },
      splitPreset: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
        })),
        createMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [{ id: 'preset-1' }]),
      },
      splitPresetParticipant: {
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
    // Appearance travels with the bundle; the old-bundle fallback is covered
    // by the blank-appearance test below.
    expect(groupCreateData[0]).toMatchObject({
      emoji: '🎉',
      color: '#a1b2c3',
    })
  })

  it('leaves appearance blank for bundles exported before the feature', async () => {
    const groupCreateData: Array<Record<string, unknown>> = []
    const tx = {
      ledger: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
          currencyCode: 'USD',
        })),
      },
      group: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          groupCreateData.push(data)
          return { id: data.id }
        }),
        update: vi.fn(async () => ({})),
      },
      groupInvitation: { findFirst: vi.fn(async () => null) },
      groupMember: { create: vi.fn(async () => ({ id: 'member-1' })) },
      ledgerParticipant: {
        create: vi.fn(async ({ data }: { data: { id?: string } }) => ({
          id: data.id ?? 'actor-participant',
        })),
        findMany: vi.fn(async () => []),
      },
      accountGroupPreference: {
        upsert: vi.fn(async () => ({ id: 'group-pref-1' })),
      },
      splitPreset: {
        create: vi.fn(async () => ({ id: 'preset-1' })),
        createMany: vi.fn(async () => ({ count: 0 })),
        findMany: vi.fn(async () => []),
      },
      splitPresetParticipant: {
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      activity: {
        create: vi.fn(async () => ({ id: 'activity-1' })),
      },
    }

    const legacyManifest = {
      ...manifest,
      group: { ...manifest.group, emoji: undefined, color: undefined },
    }

    await importCloudGroup(
      input({ manifest: legacyManifest }),
      { accountId: 'account-1' },
      {
        tx: tx as never,
        prepared: { documents: new Map(), promotedDocumentUrls: [] },
      },
    )

    const created = groupCreateData[0] as { emoji: null; color: null }
    expect(created.emoji).toBeNull()
    expect(created.color).toBeNull()
  })

  it('prefers explicit wizard appearance picks over the export', async () => {
    const groupCreateData: Array<Record<string, unknown>> = []
    const tx = {
      ledger: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
          currencyCode: 'USD',
        })),
      },
      group: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          groupCreateData.push(data)
          return { id: data.id }
        }),
        update: vi.fn(async () => ({})),
      },
      groupInvitation: { findFirst: vi.fn(async () => null) },
      groupMember: { create: vi.fn(async () => ({ id: 'member-1' })) },
      ledgerParticipant: {
        create: vi.fn(async ({ data }: { data: { id?: string } }) => ({
          id: data.id ?? 'actor-participant',
        })),
        findMany: vi.fn(async () => []),
      },
      accountGroupPreference: {
        upsert: vi.fn(async () => ({ id: 'group-pref-1' })),
      },
      splitPreset: {
        create: vi.fn(async () => ({ id: 'preset-1' })),
        createMany: vi.fn(async () => ({ count: 0 })),
        findMany: vi.fn(async () => []),
      },
      splitPresetParticipant: {
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      activity: {
        create: vi.fn(async () => ({ id: 'activity-1' })),
      },
    }

    await importCloudGroup(
      input({
        groupFormValues: {
          name: 'Trip copy',
          information: null,
          currency: '$',
          currencyCode: 'USD',
          emoji: '🍻',
          color: '#FF0000',
        },
      }),
      { accountId: 'account-1' },
      {
        tx: tx as never,
        prepared: { documents: new Map(), promotedDocumentUrls: [] },
      },
    )

    // The export carries 🎉/#a1b2c3; the wizard picks win (hex normalized).
    expect(groupCreateData[0]).toMatchObject({
      emoji: '🍻',
      color: '#ff0000',
    })
  })

  it('lets explicit-none wizard picks clear an exported appearance', async () => {
    const groupCreateData: Array<Record<string, unknown>> = []
    const tx = {
      ledger: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
          currencyCode: 'USD',
        })),
      },
      group: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          groupCreateData.push(data)
          return { id: data.id }
        }),
        update: vi.fn(async () => ({})),
      },
      groupInvitation: { findFirst: vi.fn(async () => null) },
      groupMember: { create: vi.fn(async () => ({ id: 'member-1' })) },
      ledgerParticipant: {
        create: vi.fn(async ({ data }: { data: { id?: string } }) => ({
          id: data.id ?? 'actor-participant',
        })),
        findMany: vi.fn(async () => []),
      },
      accountGroupPreference: {
        upsert: vi.fn(async () => ({ id: 'group-pref-1' })),
      },
      splitPreset: {
        create: vi.fn(async () => ({ id: 'preset-1' })),
        createMany: vi.fn(async () => ({ count: 0 })),
        findMany: vi.fn(async () => []),
      },
      splitPresetParticipant: {
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      activity: {
        create: vi.fn(async () => ({ id: 'activity-1' })),
      },
    }

    await importCloudGroup(
      input({
        groupFormValues: {
          name: '🏝️ Trip copy',
          information: null,
          currency: '$',
          currencyCode: 'USD',
          emoji: '',
          color: null,
        },
      }),
      { accountId: 'account-1' },
      {
        tx: tx as never,
        prepared: { documents: new Map(), promotedDocumentUrls: [] },
      },
    )

    // '' / null mean "none" and beat the exported 🎉/#a1b2c3. The server
    // stores the name verbatim — title-emoji extraction is client-side.
    expect(groupCreateData[0]).toMatchObject({
      name: '🏝️ Trip copy',
      emoji: '',
      color: null,
    })
  })

  it('restores account group preferences with remapped participant ids', async () => {
    const participantIds: string[] = []
    const tx = {
      ledger: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
          currencyCode: 'USD',
        })),
      },
      group: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
        })),
        update: vi.fn(async () => ({})),
      },
      groupInvitation: { findFirst: vi.fn(async () => null) },
      groupMember: { create: vi.fn(async () => ({ id: 'member-1' })) },
      ledgerParticipant: {
        create: vi.fn(async ({ data }: { data: { id?: string } }) => {
          const id = data.id ?? 'actor-participant'
          participantIds.push(id)
          return { id }
        }),
        findMany: vi.fn(async () => participantIds.map((id) => ({ id }))),
      },
      accountGroupPreference: {
        upsert: vi.fn(async () => ({ id: 'group-pref-1' })),
      },
      splitPreset: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({
          id: data.id,
        })),
        createMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [{ id: 'preset-1' }]),
      },
      splitPresetParticipant: {
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
    expect(tx.splitPreset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          participants: {
            create: [
              expect.objectContaining({ participantId: expect.any(String) }),
            ],
          },
        }),
      }),
    )
    expect(
      tx.splitPreset.create.mock.calls[0]?.[0].data.participants.create[0]
        .participantId,
    ).not.toBe('participant-1')
  })
})
