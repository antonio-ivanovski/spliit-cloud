// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../test/mocks'
import {
  deleteExpense,
  getActivities,
  getGroup,
  linkUnlinkedParticipantToAccount,
  linkUnlinkedParticipantToPendingInvite,
  mergeLedgerParticipantReferences,
  stopRecurrence,
} from '../lib/api'
import { prismaMock } from '../test/state'

vi.mock('../routes/upload', () => ({
  deleteS3Object: vi.fn(),
  promoteUploadedDocument: vi.fn(),
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

  it('includes a pending invitation with a pre-materialized LedgerParticipant in participants', async () => {
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
          ledgerParticipantId: 'lp-bob',
        },
      ],
    } as never)

    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        groupId,
        email: 'bob@example.com',
        ledgerParticipant: { id: 'lp-bob' },
      },
    ] as never)

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
    expect(bob.id).toBe('lp-bob')
    expect(prismaMock.ledgerParticipant.create).not.toHaveBeenCalled()
    expect(prismaMock.groupInvitation.update).not.toHaveBeenCalled()
  })

  it('getGroup performs no writes (read-only)', async () => {
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
          ledgerParticipantId: 'lp-existing',
        },
      ],
    } as never)

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
    expect(prismaMock.groupInvitation.update).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
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
      {
        id: 'lp-owner',
        name: 'Alice',
        account: { id: 'acct-owner', name: 'Alice', image: null },
        pending: false,
        unlinked: false,
      },
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
        account: null,
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
        account: null,
        pending: true,
        unlinked: false,
      },
    ])
  })

  it('shortens a placeholder email when the pending invitation has no temporaryName', async () => {
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
          id: 'inv-link',
          groupId,
          email:
            'qN2sMas2gSOPm5hRetmBa97B-BoR0oBjUj0pu60d9mM@link.placeholder.local',
          temporaryName: null,
          status: 'PENDING',
          ledgerParticipantId: 'lp-link',
        },
      ],
    } as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-link',
        groupId,
        email:
          'qN2sMas2gSOPm5hRetmBa97B-BoR0oBjUj0pu60d9mM@link.placeholder.local',
        temporaryName: null,
        ledgerParticipant: { id: 'lp-link' },
      },
    ] as never)

    const group = await getGroup(groupId)

    expect(group!.participants[0]).toMatchObject({
      id: 'lp-link',
      name: 'qN2sMas2…',
      pending: true,
      unlinked: false,
    })
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
        account: null,
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
      {
        id: 'lp-orphan',
        name: 'Carlos',
        account: null,
        pending: false,
        unlinked: true,
      },
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
      .mockResolvedValueOnce({
        ledgerId: 'ledger-1',
        ledger: { currencyCode: null },
      } as never)
    prismaMock.expense.findFirst.mockResolvedValue({
      id: 'exp-1',
      ledgerId: 'ledger-1',
      title: 'Dinner',
      amount: 1000,
      expenseDate: new Date(),
      expenseTimeZone: 'UTC',
      categoryId: 'general',
      paidBySplitMode: 'BY_AMOUNT',
      splitMode: 'EVENLY',
      recurrenceRule: 'NONE',
      notes: null,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidByList: [],
      paidFor: [],
      items: [],
      itemizedRemainder: null,
      documents: [],
    } as never)
    prismaMock.activity.create.mockResolvedValue({} as never)
    prismaMock.expense.deleteMany.mockResolvedValue({ count: 1 } as never)

    await deleteExpense('grp-1', 'exp-1', { accountId: 'acct-1' })

    expect(prismaMock.expense.deleteMany).toHaveBeenCalledWith({
      where: { id: 'exp-1', ledgerId: 'ledger-1' },
    })
  })

  it('deletes this and following while leaving the series active by default', async () => {
    const recurringExpense = {
      id: 'exp-2',
      ledgerId: 'ledger-1',
      title: 'Rent',
      amount: 1000,
      expenseDate: new Date('2026-07-01T00:00:00Z'),
      expenseTimeZone: 'UTC',
      categoryId: 'general',
      paidBySplitMode: 'BY_AMOUNT',
      splitMode: 'EVENLY',
      notes: null,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
      paidByList: [],
      paidFor: [],
      items: [],
      itemizedRemainder: null,
      documents: [],
      recurringSeriesId: 'series-1',
      recurrenceSequence: 2,
      recurringSeries: {
        id: 'series-1',
        frequency: 'MONTHLY',
        interval: 1,
        endType: 'INDEFINITE',
        occurrenceLimit: null,
        endDate: null,
        status: 'ACTIVE',
        anchorDate: new Date('2026-06-01T00:00:00Z'),
        nextOccurrenceDate: new Date('2026-08-01T00:00:00Z'),
      },
    }
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
      ledger: { currencyCode: null },
    } as never)
    prismaMock.expense.findFirst
      .mockResolvedValueOnce(recurringExpense as never)
      .mockResolvedValue(null)
    // Snapshot query for future rows before deleteMany.
    prismaMock.expense.findMany.mockResolvedValue([recurringExpense] as never)
    prismaMock.expense.deleteMany.mockResolvedValue({ count: 2 } as never)

    await deleteExpense(
      'grp-1',
      'exp-2',
      { accountId: 'acct-1' },
      { scope: 'THIS_AND_FUTURE' },
    )

    expect(prismaMock.expense.deleteMany).toHaveBeenCalledWith({
      where: {
        ledgerId: 'ledger-1',
        recurringSeriesId: 'series-1',
        recurrenceSequence: { gte: 2 },
      },
    })
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith({
      where: { id: 'series-1' },
      data: { version: { increment: 1 }, catchUpBatch: null },
    })
  })

  it('rejects stopping a non-recurring expense', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.expense.findFirst.mockResolvedValue({
      id: 'exp-3',
      title: 'Dinner',
      categoryId: 'general',
      recurringSeriesId: null,
      recurrenceSequence: null,
      recurringSeries: null,
    } as never)

    await expect(
      stopRecurrence('grp-1', 'exp-3', { accountId: 'acct-1' }),
    ).rejects.toThrow('Expense is not part of a recurring series')

    expect(prismaMock.recurringExpenseSeries.update).not.toHaveBeenCalled()
    expect(prismaMock.activity.create).not.toHaveBeenCalled()
  })

  it('rejects stopping an invalid expense ID', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.expense.findFirst.mockResolvedValue(null)

    await expect(
      stopRecurrence('grp-1', 'exp-missing', { accountId: 'acct-1' }),
    ).rejects.toThrow('Invalid expense ID: exp-missing')

    expect(prismaMock.recurringExpenseSeries.update).not.toHaveBeenCalled()
  })

  it('does not update or log activity for an already terminal recurrence', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.expense.findFirst.mockResolvedValue({
      id: 'exp-3',
      title: 'Rent',
      categoryId: 'general',
      recurringSeriesId: 'series-1',
      recurrenceSequence: null,
      recurringSeries: {
        frequency: 'MONTHLY',
        interval: 1,
        endType: 'INDEFINITE',
        occurrenceLimit: null,
        endDate: null,
      },
    } as never)
    prismaMock.recurringExpenseSeries.findUnique.mockResolvedValue({
      status: 'CANCELLED',
    } as never)

    await expect(
      stopRecurrence('grp-1', 'exp-3', { accountId: 'acct-1' }),
    ).resolves.toBeUndefined()

    expect(prismaMock.recurringExpenseSeries.update).not.toHaveBeenCalled()
    expect(prismaMock.activity.create).not.toHaveBeenCalled()
  })

  it('supports stopping a recurrence without deleting materialized expenses', async () => {
    const recurringExpense = {
      id: 'exp-3',
      ledgerId: 'ledger-1',
      title: 'Rent',
      amount: 1000,
      expenseDate: new Date('2026-07-01T00:00:00Z'),
      categoryId: 'general',
      paidBySplitMode: 'BY_AMOUNT',
      splitMode: 'EVENLY',
      notes: null,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
      paidByList: [],
      paidFor: [],
      items: [],
      itemizedRemainder: null,
      documents: [],
      recurringSeriesId: 'series-1',
      recurrenceSequence: 2,
      recurringSeries: {
        id: 'series-1',
        frequency: 'MONTHLY',
        interval: 1,
        endType: 'INDEFINITE',
        occurrenceLimit: null,
        endDate: null,
        status: 'ACTIVE',
        anchorDate: new Date('2026-06-01T00:00:00Z'),
        nextOccurrenceDate: new Date('2026-08-01T00:00:00Z'),
      },
    }
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.expense.findFirst
      .mockResolvedValueOnce(recurringExpense as never)
      .mockResolvedValue(null)
    prismaMock.recurringExpenseSeries.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      frequency: 'MONTHLY',
      interval: 1,
      endType: 'INDEFINITE',
      occurrenceLimit: null,
      endDate: null,
      template: {
        paidByList: [],
        paidFor: [{ ledgerParticipantId: 'lp-1', shares: 1 }],
        items: [],
        itemizedRemainder: null,
      },
    } as never)

    await stopRecurrence('grp-1', 'exp-3', { accountId: 'acct-1' })

    expect(prismaMock.expense.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.recurringExpenseSeries.update).toHaveBeenCalledWith({
      where: { id: 'series-1' },
      data: {
        status: 'CANCELLED',
        version: { increment: 1 },
        catchUpBatch: null,
      },
    })
    // A RECURRING_EXPENSE_STOPPED activity must be logged.
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'RECURRING_EXPENSE_STOPPED',
        }),
      }),
    )
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
        type: 'EXPENSE_CREATED',
        actorType: 'ACCOUNT',
        actorId: 'acct-alice',
        subjectType: 'EXPENSE',
        subjectId: 'exp-1',
        data: { kind: 'expense', summary: 'Dinner' },
      },
      {
        id: 'act-2',
        ledgerId: 'ledger-1',
        time: new Date(),
        type: 'GROUP_UPDATED',
        actorType: 'ACCOUNT',
        actorId: 'acct-bob',
        subjectType: null,
        subjectId: null,
        data: { kind: 'group', summary: 'group:settings' },
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([
      {
        id: 'exp-1',
        title: 'Dinner',
        amount: 1000,
        expenseDate: new Date(),
        categoryId: 'general',
        splitMode: 'EVENLY',
        paidBySplitMode: 'EVENLY',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
        paidByList: [
          {
            ledgerParticipantId: 'lp-alice',
            shares: 1000,
            ledgerParticipant: {
              groupMember: { account: { id: 'acct-alice' } },
            },
          },
        ],
        paidFor: [
          {
            ledgerParticipantId: 'lp-alice',
            shares: 1,
            ledgerParticipant: {
              groupMember: { account: { id: 'acct-alice' } },
            },
          },
        ],
      },
    ] as never)
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'acct-alice', name: 'Alice' },
      { id: 'acct-bob', name: 'Bob' },
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
    // Split projection is mapped to the id-only wire shape.
    expect(activities[0]).toMatchObject({
      expense: {
        id: 'exp-1',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
        paidByList: [{ ledgerParticipant: { id: 'lp-alice' }, shares: 1000 }],
        paidFor: [{ ledgerParticipant: { id: 'lp-alice' }, shares: 1 }],
      },
    })
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
        type: 'EXPENSE_CREATED',
        actorType: 'LEDGER_PARTICIPANT',
        actorId: 'lp-invitee',
        subjectType: 'EXPENSE',
        subjectId: 'exp-2',
        data: { kind: 'expense', summary: 'Lunch' },
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-invitee',
        displayName: null,
        groupMember: null,
        invitations: [{ email: 'carol@example.com', temporaryName: null }],
      },
    ] as never)

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
        type: 'EXPENSE_CREATED',
        actorType: 'LEDGER_PARTICIPANT',
        actorId: 'lp-revoked-invitee',
        subjectType: 'EXPENSE',
        subjectId: 'exp-3',
        data: { kind: 'expense', summary: 'Dinner' },
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-revoked-invitee',
        displayName: null,
        groupMember: null,
        invitations: [{ email: 'dave@example.com', temporaryName: null }],
      },
    ] as never)

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
        type: 'EXPENSE_CREATED',
        actorType: 'LEDGER_PARTICIPANT',
        actorId: 'lp-invitee',
        subjectType: 'EXPENSE',
        subjectId: 'exp-5',
        data: { kind: 'expense', summary: 'Lunch' },
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-invitee',
        displayName: null,
        groupMember: null,
        invitations: [
          {
            email: 'erin@example.com',
            temporaryName: 'Erin from the office',
          },
        ],
      },
    ] as never)

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
        type: 'GROUP_UPDATED',
        actorType: null,
        actorId: null,
        subjectType: null,
        subjectId: null,
        data: null,
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
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'acct-alice',
      name: 'Alice',
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
          data: expect.objectContaining({
            kind: 'group',
            changedFields: ['linkedParticipant'],
            changes: [
              {
                field: 'linkedParticipant',
                before: 'Jane',
                after: 'Alice',
              },
            ],
          }),
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
    prismaMock.user.findUnique.mockResolvedValue({
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
    prismaMock.expensePaidBy.updateMany.mockResolvedValue({ count: 1 } as never)
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
    expect(prismaMock.expensePaidBy.updateMany).toHaveBeenCalledWith({
      where: { ledgerParticipantId: 'lp-jane' },
      data: { ledgerParticipantId: 'lp-alice' },
    })
    expect(prismaMock.expense.updateMany).not.toHaveBeenCalled()
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
          data: expect.objectContaining({
            kind: 'group',
            changedFields: ['linkedParticipant'],
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'linkedParticipant',
                before: 'Jane',
              }),
            ]),
          }),
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
    prismaMock.user.findUnique.mockResolvedValue({
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
    prismaMock.expensePaidBy.updateMany.mockResolvedValue({ count: 0 } as never)
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
          data: expect.objectContaining({
            kind: 'group',
            changedFields: ['linkedParticipant'],
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'linkedParticipant',
                before: 'Jane',
              }),
            ]),
          }),
        }),
      }),
    )
  })

  it('rejects when the linked account is not found', async () => {
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-jane',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)
    // account.findUnique defaults to null — not found

    await expect(
      linkUnlinkedParticipantToAccount({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-jane',
        accountId: 'acct-missing',
        actor: { accountId: 'acct-admin' },
      }),
    ).rejects.toThrow('Account not found')
  })

  it('rejects when the participant is already linked to a member', async () => {
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-jane',
      ledgerId: 'ledger-1',
      groupMemberId: 'gm-jane',
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)

    await expect(
      linkUnlinkedParticipantToAccount({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-jane',
        accountId: 'acct-alice',
        actor: { accountId: 'acct-admin' },
      }),
    ).rejects.toThrow('Ledger participant is already linked to a member')
  })
})

describe('mergeLedgerParticipantReferences', () => {
  it('updates expensePaidBy and expensePaidFor references from source to target', async () => {
    prismaMock.expensePaidBy.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.expensePaidFor.updateMany.mockResolvedValue({
      count: 2,
    } as never)

    await mergeLedgerParticipantReferences(prismaMock as never, {
      sourceId: 'lp-source',
      targetId: 'lp-target',
    })

    expect(prismaMock.expensePaidBy.updateMany).toHaveBeenCalledWith({
      where: { ledgerParticipantId: 'lp-source' },
      data: { ledgerParticipantId: 'lp-target' },
    })
    expect(prismaMock.expensePaidFor.updateMany).toHaveBeenCalledWith({
      where: { ledgerParticipantId: 'lp-source' },
      data: { ledgerParticipantId: 'lp-target' },
    })
  })
})

describe('linkUnlinkedParticipantToPendingInvite', () => {
  const groupId = 'grp-1'
  const ledgerId = 'ledger-1'

  function validLp(overrides: Record<string, unknown> = {}) {
    return {
      id: 'lp-jane',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: ledgerId, group: { id: groupId } },
      ...overrides,
    }
  }

  function validInvitation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'inv-1',
      groupId,
      email: 'bob@example.com',
      status: 'PENDING',
      ledgerParticipant: {
        id: 'lp-target',
        ledgerId,
        groupMemberId: null,
      },
      ...overrides,
    }
  }

  it.each([
    [
      'source ledger participant is not found',
      null,
      undefined,
      'lp-missing',
      'inv-1',
      'Ledger participant not found',
    ],
    [
      'participant does not belong to this group',
      validLp({
        id: 'lp-other',
        ledger: { id: 'ledger-2', group: { id: 'grp-other' } },
      }),
      undefined,
      'lp-other',
      'inv-1',
      'Ledger participant does not belong to this group',
    ],
    [
      'participant is not unlinked',
      validLp({ kind: 'ACCOUNT_MEMBER' }),
      undefined,
      'lp-jane',
      'inv-1',
      'Ledger participant is not unlinked',
    ],
    [
      'participant already has a groupMemberId',
      validLp({ groupMemberId: 'gm-jane' }),
      undefined,
      'lp-jane',
      'inv-1',
      'Ledger participant is already linked to a member',
    ],
    [
      'invitation is not found',
      validLp(),
      null,
      'lp-jane',
      'inv-missing',
      'Invitation not found',
    ],
    [
      'invitation belongs to a different group',
      validLp(),
      validInvitation({
        id: 'inv-other',
        groupId: 'grp-other',
        email: 'bob@other.com',
        ledgerParticipant: null,
      }),
      'lp-jane',
      'inv-other',
      'Invitation does not belong to this group',
    ],
    [
      'invitation is not pending',
      validLp(),
      validInvitation({
        id: 'inv-accepted',
        status: 'ACCEPTED',
        ledgerParticipant: null,
      }),
      'lp-jane',
      'inv-accepted',
      'Invitation is not pending',
    ],
    [
      'invitation has no materialized ledger participant',
      validLp(),
      validInvitation({ id: 'inv-no-lp', ledgerParticipant: null }),
      'lp-jane',
      'inv-no-lp',
      'Invitation has no materialized ledger participant',
    ],
    [
      'target LP is in a different ledger',
      validLp(),
      validInvitation({
        ledgerParticipant: {
          id: 'lp-target',
          ledgerId: 'ledger-other',
          groupMemberId: null,
        },
      }),
      'lp-jane',
      'inv-1',
      'Invitation ledger participant is in a different ledger',
    ],
    [
      'merging a participant into itself (self-merge guard)',
      validLp(),
      validInvitation({
        ledgerParticipant: {
          id: 'lp-jane',
          ledgerId,
          groupMemberId: null,
        },
      }),
      'lp-jane',
      'inv-1',
      'Cannot merge a participant into itself',
    ],
  ] as Array<
    [
      string,
      Record<string, unknown> | null,
      Record<string, unknown> | null | undefined,
      string,
      string,
      string,
    ]
  >)(
    'rejects when %s',
    async (
      _label,
      lpMock,
      invMock,
      ledgerParticipantId,
      pendingInvitationId,
      expectedMessage,
    ) => {
      prismaMock.ledgerParticipant.findUnique.mockResolvedValue(lpMock as never)
      if (invMock !== undefined) {
        prismaMock.groupInvitation.findUnique.mockResolvedValue(
          invMock as never,
        )
      }

      await expect(
        linkUnlinkedParticipantToPendingInvite({
          groupId,
          ledgerParticipantId,
          pendingInvitationId,
          actor: { accountId: 'acct-admin' },
        }),
      ).rejects.toThrow(expectedMessage)
    },
  )

  it('happy path: merges references, deletes source LP, and logs activity', async () => {
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-unlinked',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: ledgerId, group: { id: groupId } },
    } as never)
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId,
      email: 'bob@example.com',
      status: 'PENDING',
      ledgerParticipant: {
        id: 'lp-target',
        ledgerId,
        groupMemberId: null,
      },
    } as never)
    prismaMock.expensePaidBy.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.expensePaidFor.updateMany.mockResolvedValue({
      count: 2,
    } as never)
    prismaMock.ledgerParticipant.delete.mockResolvedValue({} as never)
    // logActivity needs group lookup and activity.create
    prismaMock.group.findUnique.mockResolvedValue({
      ledgerId,
    } as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const result = await linkUnlinkedParticipantToPendingInvite({
      groupId,
      ledgerParticipantId: 'lp-unlinked',
      pendingInvitationId: 'inv-1',
      actor: { accountId: 'acct-admin' },
    })

    expect(result).toEqual({
      groupMemberId: null,
      ledgerParticipantId: 'lp-target',
    })
    expect(prismaMock.expensePaidBy.updateMany).toHaveBeenCalledWith({
      where: { ledgerParticipantId: 'lp-unlinked' },
      data: { ledgerParticipantId: 'lp-target' },
    })
    expect(prismaMock.expensePaidFor.updateMany).toHaveBeenCalledWith({
      where: { ledgerParticipantId: 'lp-unlinked' },
      data: { ledgerParticipantId: 'lp-target' },
    })
    expect(prismaMock.ledgerParticipant.delete).toHaveBeenCalledWith({
      where: { id: 'lp-unlinked' },
    })
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          data: expect.objectContaining({
            kind: 'group',
            changedFields: ['linkedParticipant'],
            changes: expect.arrayContaining([
              expect.objectContaining({
                field: 'linkedParticipant',
                before: 'Jane',
                after: 'bob@example.com',
              }),
            ]),
          }),
        }),
      }),
    )
  })
})
