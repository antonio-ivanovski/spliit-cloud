import { describe, expect, it } from 'vitest'
import '../../../test/mocks'
import { authState, prisma$Transaction, prismaMock } from '../../../test/state'
import { createTRPCContext } from '../../init'
import { groupsRouter } from './index'

function makeCaller(authUserId: string) {
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

async function authAs(userId: string) {
  authState.session = {
    user: { id: userId },
    session: { id: 'sess-1' },
  }
  prismaMock.account.findUnique.mockImplementation(async (args: unknown) => {
    const id = (args as { where: { id: string } }).where.id
    return {
      id,
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    }
  })
  return createTRPCContext({
    req: new Request('http://localhost/api/test'),
  })
}

function mockGroupWithMember(role: 'ADMIN' | 'MEMBER' | null) {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-1',
    ledgerId: 'ledger-1',
    archived: false,
    ledger: { id: 'ledger-1' },
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue(
    role
      ? ({
          groupId: 'grp-1',
          accountId: 'acct-x',
          role,
          status: 'ACTIVE',
        } as never)
      : null,
  )
  // `getGroupBalances` (used by the archive procedure to decide whether
  // settlement expenses must be auto-created) goes through
  // `getGroupExpenses`, which itself materialises recurring expense
  // links. The default stubs return null, so seed empty arrays here so
  // the happy-path tests can exercise the archive mutation without
  // touching the recurring-expense machinery.
  prismaMock.recurringExpenseLink.findMany.mockResolvedValue([] as never)
  prismaMock.expense.findMany.mockResolvedValue([] as never)
}

describe('groupsRouter.archive', () => {
  it('archives a group when the caller is an ADMIN', async () => {
    await authAs('acct-admin')
    mockGroupWithMember('ADMIN')
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.archive({ groupId: 'grp-1', archived: true })

    expect(result.group).toMatchObject({ id: 'grp-1', archived: true })
    expect(prismaMock.group.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grp-1' },
        data: { archived: true },
      }),
    )
  })

  it('archives a group when the caller is an ADMIN (alias check)', async () => {
    await authAs('acct-admin')
    mockGroupWithMember('ADMIN')
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)

    const caller = makeCaller('acct-admin')
    await caller.archive({ groupId: 'grp-1', archived: true })

    expect(prismaMock.group.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archived: true } }),
    )
  })

  it('unarchives a group when the caller is an ADMIN', async () => {
    await authAs('acct-admin')
    mockGroupWithMember('ADMIN')
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: false,
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.archive({ groupId: 'grp-1', archived: false })

    expect(result.group).toMatchObject({ archived: false })
    expect(prismaMock.group.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archived: false } }),
    )
  })

  it('rejects a MEMBER with FORBIDDEN', async () => {
    await authAs('acct-member')
    mockGroupWithMember('MEMBER')

    const caller = makeCaller('acct-member')
    await expect(
      caller.archive({ groupId: 'grp-1', archived: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.group.update).not.toHaveBeenCalled()
  })

  it('rejects a non-member with FORBIDDEN', async () => {
    await authAs('acct-outside')
    mockGroupWithMember(null)

    const caller = makeCaller('acct-outside')
    await expect(
      caller.archive({ groupId: 'grp-1', archived: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.group.update).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller with UNAUTHORIZED', async () => {
    authState.session = null
    const ctx = await createTRPCContext({
      req: new Request('http://localhost/api/test'),
    })

    await expect(
      groupsRouter
        .createCaller({
          auth: ctx.auth,
        } as never)
        .archive({ groupId: 'grp-1', archived: true }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

/**
 * Build a single "expense" record as `getGroupExpenses` would return it
 * after the row is materialised by Prisma. The archive flow reads these
 * rows through `getGroupBalances` to decide whether settlement expenses
 * are required, so the shape must match the `select` clause of
 * `getGroupExpenses`.
 */
function makeExpenseRow(args: {
  id: string
  amount: number
  paidById: string
  paidByName?: string
  paidFor: Array<{
    participantId: string
    participantName?: string
    shares: number
  }>
  splitMode?: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
}) {
  // `getGroupExpenses` resolves the display name at read time through
  // `GroupMember.account.name`. Tests that exercise the archive flow
  // don't model GroupMembers, so they supply the name via the `account`
  // relation (the post-processing step in `getGroupExpenses` falls back
  // to `account.name` when `groupMember` is null).
  const paidByName = args.paidByName ?? args.paidById
  return {
    id: args.id,
    amount: args.amount,
    expenseDate: new Date(),
    createdAt: new Date(),
    title: 'Test expense',
    categoryId: 'general',
    isReimbursement: false,
    recurrenceRule: 'NONE',
    splitMode: args.splitMode ?? 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    paidByList: [
      {
        shares: args.amount,
        ledgerParticipant: {
          id: args.paidById,
          groupMember: { account: { name: paidByName } },
          invitations: [],
        },
      },
    ],
    paidFor: args.paidFor.map((pf) => {
      const participantName = pf.participantName ?? pf.participantId
      return {
        shares: pf.shares,
        ledgerParticipant: {
          id: pf.participantId,
          groupMember: { account: { name: participantName } },
          invitations: [],
        },
      }
    }),
    _count: { documents: 0 },
  }
}

describe('groupsRouter.archive — unsettled balances', () => {
  it('rejects an archive with PRECONDITION_FAILED when balances are unsettled and no force flag is set', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    // Alice paid 100 for both herself and Bob. Bob owes 50.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-owner')
    await expect(
      caller.archive({ groupId: 'grp-1', archived: true }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(prismaMock.group.update).not.toHaveBeenCalled()
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })

  it('does not check balances when unarchiving', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      archived: true,
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: false,
    } as never)

    const caller = makeCaller('acct-owner')
    await caller.archive({ groupId: 'grp-1', archived: false })

    expect(prismaMock.group.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archived: false } }),
    )
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })

  it('does not check balances when re-archiving an already-archived group', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      archived: true,
      ledger: { id: 'ledger-1' },
    } as never)
    // Even with unsettled balances, re-archiving must not throw, because
    // the archive is already in effect and the new state matches the
    // previous settlement (if any).
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)

    const caller = makeCaller('acct-owner')
    await caller.archive({ groupId: 'grp-1', archived: true })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })

  it('auto-creates one settlement expense per non-zero leg when force=true and balances are unsettled', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    // The caller's ledger participant id is needed so the activity log
    // can render the actor's name (instead of "someone"). Mock it in.
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-owner',
      role: 'ADMIN',
      status: 'ACTIVE',
      ledgerParticipant: { id: 'lp-alice' },
    } as never)
    // Alice paid 100 for both — Bob owes 50.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      const data = (args as { data: { id: string } }).data
      return { id: data.id, ...(args as object) } as never
    })
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)

    const caller = makeCaller('acct-owner')
    const result = await caller.archive({
      groupId: 'grp-1',
      archived: true,
      force: true,
    })

    expect(result.group).toMatchObject({ archived: true })
    // One leg (Bob -> Alice, $0.50) is needed to settle the group.
    expect(prismaMock.expense.create).toHaveBeenCalledTimes(1)
    const createCall = prismaMock.expense.create.mock.calls[0][0] as {
      data: {
        title: string
        amount: number
        paidBySplitMode: string
        paidByList: {
          createMany: {
            data: Array<{ ledgerParticipantId: string; shares: number }>
          }
        }
        isReimbursement: boolean
        categoryId: string
        paidFor: { createMany: { data: Array<{ shares: number }> } }
      }
    }
    expect(createCall.data.title).toBe('Settlement on archive')
    expect(createCall.data.amount).toBe(50)
    expect(createCall.data.paidBySplitMode).toBe('BY_AMOUNT')
    expect(createCall.data.paidByList.createMany.data).toEqual([
      { ledgerParticipantId: 'lp-bob', shares: 50 },
    ])
    expect(createCall.data.isReimbursement).toBe(true)
    expect(createCall.data.categoryId).toBe('payment')
    expect(createCall.data.paidFor.createMany.data).toEqual([
      expect.objectContaining({ shares: 1 }),
    ])
    // The group archive and the settlement expense creation must run in
    // the same transaction.
    expect(prisma$Transaction).toHaveBeenCalledTimes(1)
    // The settlement-on-archive activity is logged with the caller's
    // participant id so the activity feed renders their name instead of
    // falling back to "someone".
    const settlementActivityCall = prismaMock.activity.create.mock.calls.find(
      (call) =>
        (call[0] as { data: { data?: string } }).data?.data ===
        'Settlement on archive',
    )
    expect(settlementActivityCall).toBeDefined()
    expect(settlementActivityCall![0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          activityType: 'CREATE_EXPENSE',
          ledgerParticipantId: 'lp-alice',
          data: 'Settlement on archive',
        }),
      }),
    )
  })

  it('creates a settlement expense for each leg when multiple members have non-zero balances', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    // Alice paid 90 for everyone evenly. Bob paid 30 for everyone evenly.
    // After expenses:
    //   Alice paid 90, paidFor 30, total = +60
    //   Bob   paid 30, paidFor 30, total =   0
    //   Carol paid  0, paidFor 30, total = -30
    //   Dave  paid  0, paidFor 30, total = -30
    // Settlement legs (one-sided):
    //   Carol -> Alice, $30
    //   Dave  -> Alice, $30
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 90,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
          { participantId: 'lp-carol', shares: 1 },
          { participantId: 'lp-dave', shares: 1 },
        ],
      }),
      makeExpenseRow({
        id: 'exp-2',
        amount: 30,
        paidById: 'lp-bob',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
          { participantId: 'lp-carol', shares: 1 },
          { participantId: 'lp-dave', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      const data = (args as { data: { id: string } }).data
      return { id: data.id, ...(args as object) } as never
    })
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)

    const caller = makeCaller('acct-owner')
    await caller.archive({
      groupId: 'grp-1',
      archived: true,
      force: true,
    })

    expect(prismaMock.expense.create).toHaveBeenCalledTimes(2)
    const amounts = prismaMock.expense.create.mock.calls
      .map((c) => (c[0] as { data: { amount: number } }).data.amount)
      .sort((a, b) => a - b)
    expect(amounts).toEqual([30, 30])
  })

  it('force-archive is a no-op for settlement when balances are already zero', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    // Settled: Alice paid 50 for herself; Bob paid 50 for himself.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 50,
        paidById: 'lp-alice',
        paidFor: [{ participantId: 'lp-alice', shares: 1 }],
      }),
      makeExpenseRow({
        id: 'exp-2',
        amount: 50,
        paidById: 'lp-bob',
        paidFor: [{ participantId: 'lp-bob', shares: 1 }],
      }),
    ] as never)
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)

    const caller = makeCaller('acct-owner')
    const result = await caller.archive({
      groupId: 'grp-1',
      archived: true,
      force: true,
    })

    expect(result.group).toMatchObject({ archived: true })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })

  it('rejects force-archive for a MEMBER with FORBIDDEN', async () => {
    await authAs('acct-member')
    mockGroupWithMember('MEMBER')
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-member')
    await expect(
      caller.archive({
        groupId: 'grp-1',
        archived: true,
        force: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
    expect(prismaMock.group.update).not.toHaveBeenCalled()
  })

  it('archives a group whose UI balances are zero despite a fractional-cent raw residual', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    // Alice paid 1 cent for everyone, evenly among 3. The raw balance
    // computation gives each non-payer 0.333… cents (rounds to 0) and
    // leaves the payer with a 1-cent residual — `hasUnsettledBalances`
    // would have flagged that as "unsettled" before the fix. The UI's
    // `getPublicBalances(getSuggestedReimbursements(...))` pipeline
    // drops the residual (no reimbursements are produced when only the
    // payer has a non-zero total), so the archive mutation must agree
    // with the UI and let the archive proceed without `force`.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 1,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
          { participantId: 'lp-carol', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)

    const caller = makeCaller('acct-owner')
    const result = await caller.archive({ groupId: 'grp-1', archived: true })

    expect(result.group).toMatchObject({ id: 'grp-1', archived: true })
    expect(prismaMock.group.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grp-1' },
        data: { archived: true },
      }),
    )
    // The archive check matches the UI view (no reimbursements, no
    // settlement expenses written).
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })

  it('does not write settlement expenses for a zero-UI-balance group even when force=true', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    // Same 1-cent 3-way expense as above, archived with `force: true`.
    // The UI shows no balances to settle, so the force-archive should
    // not auto-create any reimbursement expenses.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 1,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
          { participantId: 'lp-carol', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      const data = (args as { data: { id: string } }).data
      return { id: data.id, ...(args as object) } as never
    })
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)

    const caller = makeCaller('acct-owner')
    const result = await caller.archive({
      groupId: 'grp-1',
      archived: true,
      force: true,
    })

    expect(result.group).toMatchObject({ archived: true })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
    // The archive still runs inside a transaction so the flip and any
    // settlement expenses commit atomically — even when the body is a
    // no-op for settlement.
    expect(prisma$Transaction).toHaveBeenCalledTimes(1)
  })

  it('rejects an archive with PRECONDITION_FAILED when the UI balance is non-zero, even with a fractional raw residual', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    // 1000 cents split evenly among 3 = 333.333… each, which rounds
    // to 333 per participant. Raw: Alice +667, Bob -333, Carol -333.
    // Public: Alice +666, Bob -333, Carol -333 (1-cent residual on
    // Alice's side from the integer-cents reimbursement pipeline).
    // The UI balance is non-zero, so the archive must reject.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 1000,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
          { participantId: 'lp-carol', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-owner')
    await expect(
      caller.archive({ groupId: 'grp-1', archived: true }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(prismaMock.group.update).not.toHaveBeenCalled()
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })

  it('force-archive a group with a real UI balance creates one settlement expense per UI leg', async () => {
    await authAs('acct-owner')
    mockGroupWithMember('ADMIN')
    // Alice paid 1000 cents for all 3 evenly. The UI shows Alice
    // +666, Bob -333, Carol -333 (a 1-cent residual from the
    // integer-cents reimbursement). The expected settlement legs are
    // Bob -> Alice for 333 and Carol -> Alice for 333 (totaling 666,
    // which is what the UI actually shows).
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 1000,
        paidById: 'lp-alice',
        paidFor: [
          { participantId: 'lp-alice', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
          { participantId: 'lp-carol', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      const data = (args as { data: { id: string } }).data
      return { id: data.id, ...(args as object) } as never
    })
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)

    const caller = makeCaller('acct-owner')
    const result = await caller.archive({
      groupId: 'grp-1',
      archived: true,
      force: true,
    })

    expect(result.group).toMatchObject({ archived: true })
    // Two legs (Bob -> Alice, Carol -> Alice), each for 333 cents.
    expect(prismaMock.expense.create).toHaveBeenCalledTimes(2)
    const legs = prismaMock.expense.create.mock.calls.map(
      (c) =>
        (
          c[0] as {
            data: {
              amount: number
              paidByList: {
                createMany: {
                  data: Array<{ ledgerParticipantId: string; shares: number }>
                }
              }
              isReimbursement: boolean
              categoryId: string
            }
          }
        ).data,
    )
    const amounts = legs.map((l) => l.amount).sort((a, b) => a - b)
    expect(amounts).toEqual([333, 333])
    for (const leg of legs) {
      expect(leg.isReimbursement).toBe(true)
      expect(leg.categoryId).toBe('payment')
      expect(['lp-bob', 'lp-carol']).toContain(
        leg.paidByList.createMany.data[0].ledgerParticipantId,
      )
    }
  })
})

describe('groupsRouter.update — role check', () => {
  it('rejects a MEMBER with FORBIDDEN', async () => {
    await authAs('acct-member')
    mockGroupWithMember('MEMBER')

    const caller = makeCaller('acct-member')
    await expect(
      caller.update({
        groupId: 'grp-1',
        groupFormValues: {
          name: 'Whatever',
          information: '',
          currency: '$',
          currencyCode: 'USD',
          participants: [{ name: 'Owner' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('allows an ADMIN to update group settings', async () => {
    await authAs('acct-admin')
    mockGroupWithMember('ADMIN')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      archived: false,
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.group.update.mockResolvedValue({ id: 'grp-1' } as never)
    prismaMock.ledger.update.mockResolvedValue({ id: 'ledger-1' } as never)

    const caller = makeCaller('acct-admin')
    await caller.update({
      groupId: 'grp-1',
      groupFormValues: {
        name: 'Updated',
        information: '',
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Owner' }],
      },
    })
    expect(prismaMock.group.update).toHaveBeenCalled()
  })
})
