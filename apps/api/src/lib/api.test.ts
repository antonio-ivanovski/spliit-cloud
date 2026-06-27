// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../test/mocks'
import { prismaMock } from '../test/state'
import {
  deleteExpense,
  getActivities,
  getGroup,
  linkUnlinkedParticipantToAccount,
} from '../lib/api'

vi.mock('../routes/upload', () => ({
  deleteS3Object: vi.fn(),
  markS3ObjectAsOwned: vi.fn(),
}))

beforeEach(() => {
  // The import-aware `getGroup` always reads unlinked
  // LedgerParticipants (a name-only imported-entry pool) and merges
  // them into the participants list. The default per-method stub
  // returns null, which would crash the spread — default it to an
  // empty array so the existing test fixtures keep working.
  prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)
})

describe('getGroup — pending invitations as participants', () => {
  const groupId = 'grp-1'
  const ledgerId = 'ledger-1'

  it('materializes a LedgerParticipant for a pending invitation and includes it in participants', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [
        {
          id: 'gm-owner',
          groupId,
          accountId: 'acct-owner',
          role: 'ADMIN',
          status: 'ACTIVE',
          joinedAt: new Date(),
          ledgerParticipant: { id: 'lp-owner' },
          account: {
            id: 'acct-owner',
            email: 'alice@example.com',
            emailVerified: true,
            name: 'Alice',
          },
        },
      ],
      invitations: [
        {
          id: 'inv-1',
          groupId,
          email: 'bob@example.com',
          status: 'PENDING',
          ledgerParticipantId: null,
        },
      ],
    } as never)

    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue(null)
    // Capture the id used when creating the participant and return it from the
    // re-read so the API's response includes it as the materialized id.
    let createdId: string | undefined
    prismaMock.ledgerParticipant.create.mockImplementation((async (
      args: unknown,
    ) => {
      createdId = (args as { data: { id: string } }).data.id
      return { id: createdId } as never
    }) as never)
    prismaMock.groupInvitation.update.mockResolvedValue({} as never)
    prismaMock.groupInvitation.findMany.mockImplementation(
      (async () =>
        [
          {
            id: 'inv-1',
            groupId,
            email: 'bob@example.com',
            ledgerParticipant: createdId ? { id: createdId } : null,
          },
        ] as never) as never,
    )

    const group = await getGroup(groupId)

    expect(group).not.toBeNull()
    const participants = group!.participants as Array<{
      id: string
      name: string
      pending: boolean
    }>
    expect(participants).toHaveLength(2)
    const owner = participants.find((p) => p.id === 'lp-owner')!
    const bob = participants.find((p) => p.pending) as {
      id: string
      name: string
      pending: boolean
    }
    expect(owner.pending).toBe(false)
    expect(owner.name).toBe('Alice')
    expect(bob.pending).toBe(true)
    expect(bob.name).toBe('bob@example.com')
    expect(typeof bob.id).toBe('string')
    expect(bob.id.length).toBeGreaterThan(0)
    expect(prismaMock.ledgerParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ledgerId,
        }),
      }),
    )
    expect(prismaMock.groupInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ ledgerParticipantId: bob.id }),
      }),
    )
  })

  it('reuses an existing orphaned LedgerParticipant with a matching name when one is found', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [],
      invitations: [
        {
          id: 'inv-2',
          groupId,
          email: 'carol@example.com',
          status: 'PENDING',
          ledgerParticipantId: null,
        },
      ],
    } as never)

    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue({
      id: 'lp-existing',
    } as never)
    prismaMock.groupInvitation.update.mockResolvedValue({} as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-2',
        groupId,
        email: 'carol@example.com',
        ledgerParticipant: {
          id: 'lp-existing',
        },
      },
    ] as never)

    const group = await getGroup(groupId)

    expect(group!.participants).toHaveLength(1)
    expect(group!.participants[0]).toMatchObject({
      id: 'lp-existing',
      pending: true,
    })
    expect(prismaMock.ledgerParticipant.create).not.toHaveBeenCalled()
    expect(prismaMock.groupInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-2' },
        data: { ledgerParticipantId: 'lp-existing' },
      }),
    )
  })

  it('does not touch the database when the group has no pending invitations', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [
        {
          id: 'gm-owner',
          groupId,
          accountId: 'acct-owner',
          role: 'ADMIN',
          status: 'ACTIVE',
          joinedAt: new Date(),
          ledgerParticipant: { id: 'lp-owner' },
          account: {
            id: 'acct-owner',
            email: 'alice@example.com',
            emailVerified: true,
            name: 'Alice',
          },
        },
      ],
      invitations: [],
    } as never)

    const group = await getGroup(groupId)

    expect(group!.participants).toEqual([
      { id: 'lp-owner', name: 'Alice', pending: false, unlinked: false },
    ])
    expect(prismaMock.ledgerParticipant.create).not.toHaveBeenCalled()
    expect(prismaMock.groupInvitation.update).not.toHaveBeenCalled()
  })

  it('prefers the invitation temporaryName over the email when rendering a pending participant', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [],
      invitations: [
        {
          id: 'inv-3',
          groupId,
          email: 'dave@example.com',
          temporaryName: 'Dave from accounting',
          status: 'PENDING',
          ledgerParticipantId: 'lp-dave',
        },
      ],
    } as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-3',
        groupId,
        email: 'dave@example.com',
        temporaryName: 'Dave from accounting',
        ledgerParticipant: { id: 'lp-dave' },
      },
    ] as never)

    const group = await getGroup(groupId)

    expect(group!.participants).toEqual([
      {
        id: 'lp-dave',
        name: 'Dave from accounting',
        pending: true,
        unlinked: false,
      },
    ])
  })

  it('falls back to the email when the pending invitation has no temporaryName', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [],
      invitations: [
        {
          id: 'inv-4',
          groupId,
          email: 'dave@example.com',
          temporaryName: null,
          status: 'PENDING',
          ledgerParticipantId: 'lp-dave',
        },
      ],
    } as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-4',
        groupId,
        email: 'dave@example.com',
        temporaryName: null,
        ledgerParticipant: { id: 'lp-dave' },
      },
    ] as never)

    const group = await getGroup(groupId)

    expect(group!.participants).toEqual([
      {
        id: 'lp-dave',
        name: 'dave@example.com',
        pending: true,
        unlinked: false,
      },
    ])
  })

  it('skips an unlinked LedgerParticipant that a pending invitation already references', async () => {
    // When an INVITE_BY_LINK import materializes the invitee's LP
    // before the commit (so expenses already point at it), the
    // invitation's `ledgerParticipantId` matches the unlinked LP.
    // `getGroup` must NOT surface the same person twice (once as
    // unlinked + once as pending invitee) — the pending view wins.
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [],
      invitations: [
        {
          id: 'inv-jane',
          groupId,
          email: 'link-placeholder@placeholder.local',
          temporaryName: 'Jane',
          status: 'PENDING',
          ledgerParticipantId: 'lp-jane',
        },
      ],
    } as never)
    // The pending link invitation has its LP attached.
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-jane',
        groupId,
        email: 'link-placeholder@placeholder.local',
        temporaryName: 'Jane',
        ledgerParticipant: { id: 'lp-jane' },
      },
    ] as never)
    // The same LP is also surfaced as an unlinked entry — this is
    // the state the import commit leaves behind. The read path must
    // filter it out so the balances list doesn't double-count.
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      { id: 'lp-jane', displayName: 'Jane' },
    ] as never)
    const group = await getGroup(groupId)
    expect(group!.participants).toEqual([
      {
        id: 'lp-jane',
        name: 'Jane',
        pending: true,
        unlinked: false,
      },
    ])
  })

  it('keeps unlinked LedgerParticipants that are NOT referenced by any invitation', async () => {
    // Sanity check: the filter only removes unlinked LPs that are
    // already covered by a pending invitation. Genuinely unlinked
    // imported entries (no matching invite) keep their surface.
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [],
      invitations: [],
    } as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      { id: 'lp-orphan', displayName: 'Carlos' },
    ] as never)
    const group = await getGroup(groupId)
    expect(group!.participants).toEqual([
      { id: 'lp-orphan', name: 'Carlos', pending: false, unlinked: true },
    ])
  })
})

describe('deleteExpense', () => {
  it('does not delete an expense outside the group ledger', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.expense.findFirst.mockResolvedValue(null)

    await expect(
      deleteExpense('grp-1', 'exp-other-ledger', { accountId: 'acct-1' }),
    ).rejects.toThrow('Invalid expense ID: exp-other-ledger')

    expect(prismaMock.activity.create).not.toHaveBeenCalled()
    expect(prismaMock.expense.deleteMany).not.toHaveBeenCalled()
  })

  it('deletes an expense only within the scoped ledger', async () => {
    prismaMock.group.findUnique
      .mockResolvedValueOnce({ ledgerId: 'ledger-1' } as never)
      .mockResolvedValueOnce({ ledgerId: 'ledger-1' } as never)
    prismaMock.expense.findFirst.mockResolvedValue({
      id: 'exp-1',
      ledgerId: 'ledger-1',
      title: 'Dinner',
      categoryId: 'general',
      paidFor: [],
      documents: [],
    } as never)
    prismaMock.activity.create.mockResolvedValue({} as never)
    prismaMock.expense.deleteMany.mockResolvedValue({ count: 1 } as never)

    await deleteExpense('grp-1', 'exp-1', { accountId: 'acct-1' })

    expect(prismaMock.expense.deleteMany).toHaveBeenCalledWith({
      where: { id: 'exp-1', ledgerId: 'ledger-1' },
    })
  })
})

describe('getActivities', () => {
  it("resolves the actor's display name from the participant's account at read time", async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'act-1',
        ledgerId: 'ledger-1',
        time: new Date(),
        activityType: 'CREATE_EXPENSE',
        ledgerParticipantId: 'lp-alice',
        accountId: 'acct-alice',
        expenseId: 'exp-1',
        data: 'Dinner',
        ledgerParticipant: {
          groupMember: { account: { name: 'Alice' } },
          invitations: [],
        },
      },
      {
        id: 'act-2',
        ledgerId: 'ledger-1',
        time: new Date(),
        activityType: 'UPDATE_GROUP',
        ledgerParticipantId: 'lp-bob',
        accountId: 'acct-bob',
        expenseId: null,
        data: 'group:settings',
        ledgerParticipant: {
          groupMember: { account: { name: 'Bob' } },
          invitations: [],
        },
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([
      { id: 'exp-1', ledgerId: 'ledger-1' },
    ] as never)

    const activities = await getActivities('grp-1')

    expect(activities).toHaveLength(2)
    expect(activities[0]).toMatchObject({
      id: 'act-1',
      actorName: 'Alice',
    })
    expect(activities[1]).toMatchObject({
      id: 'act-2',
      actorName: 'Bob',
    })
    // The raw `ledgerParticipant` relation is not leaked into the
    // response — the API exposes only `actorName`.
    expect(
      (activities[0] as Record<string, unknown>).ledgerParticipant,
    ).toBeUndefined()
  })

  it('resolves the actor name from a pending invitation when the participant is invitee-backed', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'act-3',
        ledgerId: 'ledger-1',
        time: new Date(),
        activityType: 'CREATE_EXPENSE',
        ledgerParticipantId: 'lp-invitee',
        accountId: null,
        expenseId: 'exp-2',
        data: 'Lunch',
        ledgerParticipant: {
          groupMember: null,
          invitations: [{ email: 'carol@example.com' }],
        },
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([] as never)

    const activities = await getActivities('grp-1')

    expect(activities[0]).toMatchObject({
      actorName: 'carol@example.com',
    })
  })

  it('resolves the actor name from a REVOKED invitation when the invitee never accepted and the invite was later revoked', async () => {
    // The participant has no groupMember (invitee never accepted) and
    // the invitation is REVOKED — but the link is preserved on revoke
    // so the activity feed can still recover the email. The UI only
    // shows PENDING invitations, so the link is invisible to users.
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'act-revoked',
        ledgerId: 'ledger-1',
        time: new Date(),
        activityType: 'CREATE_EXPENSE',
        ledgerParticipantId: 'lp-revoked-invitee',
        accountId: null,
        expenseId: 'exp-3',
        data: 'Dinner',
        ledgerParticipant: {
          groupMember: null,
          invitations: [{ email: 'dave@example.com', temporaryName: null }],
        },
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([] as never)

    const activities = await getActivities('grp-1')

    expect(activities[0]).toMatchObject({
      actorName: 'dave@example.com',
    })
  })

  it('prefers a pending invitation temporaryName over the email when rendering the actor', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'act-5',
        ledgerId: 'ledger-1',
        time: new Date(),
        activityType: 'CREATE_EXPENSE',
        ledgerParticipantId: 'lp-invitee',
        accountId: null,
        expenseId: 'exp-5',
        data: 'Lunch',
        ledgerParticipant: {
          groupMember: null,
          invitations: [
            {
              email: 'erin@example.com',
              temporaryName: 'Erin from the office',
            },
          ],
        },
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([] as never)

    const activities = await getActivities('grp-1')

    expect(activities[0]).toMatchObject({
      actorName: 'Erin from the office',
    })
  })

  it('returns null actorName when the activity has no participant', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'act-4',
        ledgerId: 'ledger-1',
        time: new Date(),
        activityType: 'UPDATE_GROUP',
        ledgerParticipantId: null,
        accountId: null,
        expenseId: null,
        data: null,
        ledgerParticipant: null,
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([] as never)

    const activities = await getActivities('grp-1')

    expect(activities[0]).toMatchObject({ actorName: null })
  })
})

describe('linkUnlinkedParticipantToAccount', () => {
  it('rejects when the source LP is not an UNLINKED_PARTICIPANT', async () => {
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-alice',
      ledgerId: 'ledger-1',
      groupMemberId: 'gm-alice',
      kind: 'ACCOUNT_MEMBER',
      displayName: null,
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)

    await expect(
      linkUnlinkedParticipantToAccount({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-alice',
        accountId: 'acct-jane',
        actor: { accountId: 'acct-admin' },
      }),
    ).rejects.toThrow('Ledger participant is not unlinked')
  })

  it('migrates an UNLINKED_PARTICIPANT to the target account and logs activity', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-jane',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-alice',
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue(null as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'gm-alice',
      groupId: 'grp-1',
      accountId: 'acct-alice',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({} as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const result = await linkUnlinkedParticipantToAccount({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-jane',
      accountId: 'acct-alice',
      actor: { accountId: 'acct-admin' },
    })

    expect(result).toEqual({
      groupMemberId: 'gm-alice',
      ledgerParticipantId: 'lp-jane',
    })
    expect(prismaMock.ledgerParticipant.update).toHaveBeenCalledWith({
      where: { id: 'lp-jane' },
      data: {
        groupMemberId: 'gm-alice',
        kind: 'ACCOUNT_MEMBER',
        displayName: null,
      },
    })
    expect(prismaMock.groupMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'MEMBER' }),
      }),
    )
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          data: 'ledger-participant:linked:lp-jane',
        }),
      }),
    )
  })

  it('merges the unlinked LP into the existing member LP when the destination is already a member', async () => {
    // Regression: when the destination account is already a group
    // member with an LP in this ledger, the previous flow tried to
    // UPDATE the unlinked LP's `groupMemberId` to the member's id and
    // tripped the @unique constraint on `groupMemberId` because the
    // existing LP already owned that value. The merge path rewrites
    // references and drops the unlinked row.
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.ledgerParticipant.findUnique.mockImplementation(
      async (args: unknown) => {
        const where = (
          args as { where: { id?: string; groupMemberId?: string } }
        ).where
        if (where.id === 'lp-jane') {
          return {
            id: 'lp-jane',
            ledgerId: 'ledger-1',
            groupMemberId: null,
            kind: 'UNLINKED_PARTICIPANT',
            displayName: 'Jane',
            ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
          } as never
        }
        if (where.groupMemberId === 'gm-alice') {
          return {
            id: 'lp-alice',
            ledgerId: 'ledger-1',
            groupMemberId: 'gm-alice',
            kind: 'ACCOUNT_MEMBER',
            displayName: null,
            ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
          } as never
        }
        return null as never
      },
    )
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-alice',
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      id: 'gm-alice',
      groupId: 'grp-1',
      accountId: 'acct-alice',
      role: 'MEMBER',
      status: 'ACTIVE',
      joinedAt: new Date(),
    } as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-alice',
      groupId: 'grp-1',
      accountId: 'acct-alice',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.expensePaidFor.updateMany.mockResolvedValue({
      count: 2,
    } as never)
    prismaMock.expense.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.ledgerParticipant.delete.mockResolvedValue({} as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const result = await linkUnlinkedParticipantToAccount({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-jane',
      accountId: 'acct-alice',
      actor: { accountId: 'acct-admin' },
    })

    // The canonical (existing) LP id is returned, not the source LP id.
    expect(result).toEqual({
      groupMemberId: 'gm-alice',
      ledgerParticipantId: 'lp-alice',
    })
    expect(prismaMock.expensePaidFor.updateMany).toHaveBeenCalledWith({
      where: { ledgerParticipantId: 'lp-jane' },
      data: { ledgerParticipantId: 'lp-alice' },
    })
    expect(prismaMock.expense.updateMany).toHaveBeenCalledWith({
      where: { paidById: 'lp-jane' },
      data: { paidById: 'lp-alice' },
    })
    expect(prismaMock.ledgerParticipant.delete).toHaveBeenCalledWith({
      where: { id: 'lp-jane' },
    })
    // The merge path does not update the LP — the existing LP and
    // groupMember are unchanged. The @unique constraint stays safe.
    expect(prismaMock.ledgerParticipant.update).not.toHaveBeenCalled()
    // The reactivation update must not touch `role` — preserving the
    // existing member's privilege level (regression for admin demotion).
    expect(prismaMock.groupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gm-alice' },
        data: expect.not.objectContaining({ role: expect.anything() }),
      }),
    )
    expect(prismaMock.groupMember.create).not.toHaveBeenCalled()
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          data: 'ledger-participant:merged:lp-jane:lp-alice',
        }),
      }),
    )
  })

  it('preserves ADMIN role when an admin re-links an unlinked LP into their own existing membership', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.ledgerParticipant.findUnique.mockImplementation(
      async (args: unknown) => {
        const where = (
          args as { where: { id?: string; groupMemberId?: string } }
        ).where
        if (where.id === 'lp-jane') {
          return {
            id: 'lp-jane',
            ledgerId: 'ledger-1',
            groupMemberId: null,
            kind: 'UNLINKED_PARTICIPANT',
            displayName: 'Jane',
            ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
          } as never
        }
        if (where.groupMemberId === 'gm-alice') {
          return {
            id: 'lp-alice',
            ledgerId: 'ledger-1',
            groupMemberId: 'gm-alice',
            kind: 'ACCOUNT_MEMBER',
            displayName: null,
            ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
          } as never
        }
        return null as never
      },
    )
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-alice',
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      id: 'gm-alice',
      groupId: 'grp-1',
      accountId: 'acct-alice',
      role: 'ADMIN',
      status: 'ACTIVE',
      joinedAt: new Date(),
    } as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-alice',
      groupId: 'grp-1',
      accountId: 'acct-alice',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.expensePaidFor.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.expense.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.ledgerParticipant.delete.mockResolvedValue({} as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const result = await linkUnlinkedParticipantToAccount({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-jane',
      accountId: 'acct-alice',
      actor: { accountId: 'acct-admin' },
    })

    expect(result).toEqual({
      groupMemberId: 'gm-alice',
      ledgerParticipantId: 'lp-alice',
    })
    // The reactivation update must not include `role` — admins stay admins.
    const updateCall = prismaMock.groupMember.update.mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(updateCall.data).not.toHaveProperty('role')
    expect(prismaMock.groupMember.create).not.toHaveBeenCalled()
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          data: 'ledger-participant:merged:lp-jane:lp-alice',
        }),
      }),
    )
  })
})
