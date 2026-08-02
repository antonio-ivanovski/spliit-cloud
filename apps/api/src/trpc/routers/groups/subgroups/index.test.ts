import { describe, expect, it } from 'vitest'

import '../../../../test/mocks'
import { usePrismaMemoryStore } from '../../../../test/prisma-memory-store'
import { prismaMock } from '../../../../test/state'
import { groupsRouter } from '../index'

function makeCaller(authUserId = 'acct-self') {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never)
}

function baseData({
  role = 'ADMIN',
  enabled = true,
  groupType = 'GROUP',
}: {
  role?: 'ADMIN' | 'MEMBER'
  enabled?: boolean
  groupType?: 'GROUP' | 'FRIEND'
} = {}) {
  return {
    ledger: [{ id: 'ledger-1', currency: '$', currencyCode: 'USD' }],
    group: [
      {
        id: 'grp-1',
        name: 'Trip',
        ledgerId: 'ledger-1',
        archived: false,
        groupType,
        subgroupsEnabled: enabled,
      },
    ],
    groupMember: [
      {
        id: 'gm-self',
        groupId: 'grp-1',
        accountId: 'acct-self',
        role,
        status: 'ACTIVE',
      },
    ],
    ledgerParticipant: [
      {
        id: 'lp-a',
        ledgerId: 'ledger-1',
        groupMemberId: 'gm-self',
        kind: 'ACCOUNT_MEMBER',
        displayName: null,
        removedAt: null,
      },
      {
        id: 'lp-b',
        ledgerId: 'ledger-1',
        groupMemberId: null,
        kind: 'UNLINKED_PARTICIPANT',
        displayName: 'Bela',
        removedAt: null,
      },
      {
        id: 'lp-c',
        ledgerId: 'ledger-1',
        groupMemberId: null,
        kind: 'UNLINKED_PARTICIPANT',
        displayName: 'Carlos',
        removedAt: null,
      },
    ],
  }
}

describe('groupsRouter.subgroups', () => {
  it('creates and lists a subgroup for an admin', async () => {
    usePrismaMemoryStore(baseData())
    const caller = makeCaller()

    const created = await caller.subgroups.create({
      groupId: 'grp-1',
      name: 'Couple',
      participantIds: ['lp-a', 'lp-b'],
    })
    expect(created.subgroup).toMatchObject({
      name: 'Couple',
      participantIds: ['lp-a', 'lp-b'],
    })

    const listed = await caller.subgroups.list({ groupId: 'grp-1' })
    expect(listed).toMatchObject({
      enabled: true,
      subgroups: [created.subgroup],
    })
  })

  it('rejects non-admin mutations and unsupported friend ledgers', async () => {
    usePrismaMemoryStore(baseData({ role: 'MEMBER' }))
    await expect(
      makeCaller().subgroups.create({
        groupId: 'grp-1',
        name: 'Couple',
        participantIds: ['lp-a', 'lp-b'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    usePrismaMemoryStore(baseData({ groupType: 'FRIEND' }))
    await expect(
      makeCaller().subgroups.setEnabled({ groupId: 'grp-1', enabled: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects overlapping membership and invalid participant sets', async () => {
    usePrismaMemoryStore(baseData())
    const caller = makeCaller()
    await caller.subgroups.create({
      groupId: 'grp-1',
      name: 'Couple',
      participantIds: ['lp-a', 'lp-b'],
    })

    await expect(
      caller.subgroups.create({
        groupId: 'grp-1',
        name: 'Another',
        participantIds: ['lp-a', 'lp-c'],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      caller.subgroups.create({
        groupId: 'grp-1',
        name: 'One person',
        participantIds: ['lp-c'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('disabling subgroups deletes definitions atomically', async () => {
    usePrismaMemoryStore(baseData())
    const caller = makeCaller()
    await caller.subgroups.create({
      groupId: 'grp-1',
      name: 'Couple',
      participantIds: ['lp-a', 'lp-b'],
    })

    await caller.subgroups.setEnabled({ groupId: 'grp-1', enabled: false })
    expect(await caller.subgroups.list({ groupId: 'grp-1' })).toEqual({
      enabled: false,
      subgroups: [],
    })
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'GROUP_UPDATED',
          data: expect.objectContaining({
            kind: 'group',
            summary: 'subgroups:disabled',
            changedFields: ['subgroupsEnabled'],
            changes: [
              {
                field: 'subgroupsEnabled',
                before: 'Enabled',
                after: 'Disabled',
              },
            ],
          }),
        }),
      }),
    )
    expect(
      await caller.subgroups.setEnabled({ groupId: 'grp-1', enabled: true }),
    ).toEqual({ enabled: true })
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'GROUP_UPDATED',
          data: expect.objectContaining({
            kind: 'group',
            summary: 'subgroups:enabled',
            changedFields: ['subgroupsEnabled'],
            changes: [
              {
                field: 'subgroupsEnabled',
                before: 'Disabled',
                after: 'Enabled',
              },
            ],
          }),
        }),
      }),
    )
  })
})
