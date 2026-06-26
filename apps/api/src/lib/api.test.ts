// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { describe, expect, it, vi } from 'vitest'
import '../test/mocks'
import { prismaMock } from '../test/state'
import { deleteExpense, getActivities, getGroup } from '../lib/api'

vi.mock('../routes/upload', () => ({
  deleteS3Object: vi.fn(),
  markS3ObjectAsOwned: vi.fn(),
}))

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
      { id: 'lp-owner', name: 'Alice', pending: false },
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
      { id: 'lp-dave', name: 'dave@example.com', pending: true },
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
