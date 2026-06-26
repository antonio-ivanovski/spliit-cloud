import { beforeEach, describe, expect, it } from 'vitest'
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

/**
 * Build the prisma stubs the leave procedure needs to:
 *   - resolve the group and the caller's membership (`loadGroupContext`),
 *   - count remaining active admins / members,
 *   - run balance queries via `getGroupBalances` (which goes through
 *     `getGroupExpenses` and `createRecurringExpenses`).
 *
 * `role` is the caller's role. `activeMemberCount` is the number of
 * *other* active members in the group (excluding the caller). `archived`
 * defaults to false so the happy path doesn't have to opt out.
 */
function seedLeaveContext(args: {
  callerRole: 'ADMIN' | 'MEMBER'
  otherMemberCount: number
  otherAdminCount?: number
  otherMembers?: Array<{
    id: string
    role: 'ADMIN' | 'MEMBER'
    name: string
    participantId: string
  }>
  archived?: boolean
  callerParticipantId?: string
  ledgerId?: string
  groupId?: string
}) {
  const groupId = args.groupId ?? 'grp-1'
  const ledgerId = args.ledgerId ?? 'ledger-1'
  const callerParticipantId = args.callerParticipantId ?? 'lp-self'
  const otherMembers = args.otherMembers ?? []

  prismaMock.group.findUnique.mockResolvedValue({
    id: groupId,
    ledgerId,
    archived: args.archived ?? false,
    ledger: { id: ledgerId },
  } as never)
  prismaMock.groupMember.findUnique.mockImplementation(async (q: unknown) => {
    const where = (q as { where: unknown }).where
    if ('groupId_accountId' in (where as object)) {
      const wa = (
        where as { groupId_accountId: { groupId: string; accountId: string } }
      ).groupId_accountId
      if (wa.accountId === 'acct-self') {
        return {
          id: 'gm-self',
          groupId: wa.groupId,
          accountId: wa.accountId,
          role: args.callerRole,
          status: 'ACTIVE',
          ledgerParticipant: { id: callerParticipantId },
        }
      }
      return null
    }
    const id = (where as { id: string }).id
    const found = otherMembers.find((m) => m.id === id)
    if (!found) return null
    return {
      id: found.id,
      groupId,
      accountId: `acct-${found.id}`,
      role: found.role,
      status: 'ACTIVE',
    }
  })

  prismaMock.groupMember.findMany.mockImplementation(async () => {
    return otherMembers.map((m) => ({
      id: m.id,
      groupId,
      accountId: `acct-${m.id}`,
      role: m.role,
      status: 'ACTIVE',
      account: { id: `acct-${m.id}`, name: m.name, email: null },
      ledgerParticipant: null,
    }))
  })

  prismaMock.groupMember.count.mockImplementation(async (q: unknown) => {
    const where = (q as { where: { role?: string } }).where
    if (where.role === 'ADMIN') {
      return args.otherAdminCount ?? 0
    }
    return args.otherMemberCount
  })

  prismaMock.recurringExpenseLink.findMany.mockResolvedValue([] as never)
  prismaMock.expense.findMany.mockResolvedValue([] as never)
  prismaMock.activity.create.mockResolvedValue({ id: 'act-1' } as never)
  return { groupId, ledgerId, callerParticipantId }
}

/**
 * Build a single "expense" record as `getGroupExpenses` would return it
 * after the row is materialised by Prisma. Mirrors the shape used in
 * `archive.test.ts` so the leave tests share the same balance pipeline.
 */
function makeExpenseRow(args: {
  id: string
  amount: number
  paidById: string
  paidFor: Array<{ participantId: string; shares: number }>
}) {
  return {
    id: args.id,
    amount: args.amount,
    expenseDate: new Date(),
    createdAt: new Date(),
    title: 'Test expense',
    categoryId: 'general',
    isReimbursement: false,
    recurrenceRule: 'NONE',
    splitMode: 'EVENLY',
    paidBy: {
      id: args.paidById,
      groupMember: { account: { name: args.paidById } },
      invitations: [],
    },
    paidFor: args.paidFor.map((pf) => ({
      shares: pf.shares,
      ledgerParticipant: {
        id: pf.participantId,
        groupMember: { account: { name: pf.participantId } },
        invitations: [],
      },
    })),
    _count: { documents: 0 },
  }
}

beforeEach(() => {
  // Reset mocks between tests so the prisma stub implementations don't
  // leak between cases.
})

describe('groupsRouter.leavePreview', () => {
  it('returns role, last-admin flags, and the admin/member lists', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 2,
      otherAdminCount: 1,
      otherMembers: [
        {
          id: 'gm-other-admin',
          role: 'ADMIN',
          name: 'Bob',
          participantId: 'lp-bob',
        },
        {
          id: 'gm-other-member',
          role: 'MEMBER',
          name: 'Carol',
          participantId: 'lp-carol',
        },
      ],
    })

    const caller = makeCaller('acct-self')
    const result = await caller.leavePreview({ groupId: 'grp-1' })

    expect(result.role).toBe('ADMIN')
    expect(result.isLastActiveMember).toBe(false)
    expect(result.isLastAdmin).toBe(false)
    expect(result.hasUnsettledBalance).toBe(false)
    expect(result.otherAdmins).toEqual([{ id: 'gm-other-admin', name: 'Bob' }])
    expect(result.promotableMembers.map((m) => m.id).sort()).toEqual([
      'gm-other-admin',
      'gm-other-member',
    ])
  })

  it('flags isLastAdmin=true when no other admin exists', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 0,
      otherMembers: [
        {
          id: 'gm-other-member',
          role: 'MEMBER',
          name: 'Carol',
          participantId: 'lp-carol',
        },
      ],
    })

    const caller = makeCaller('acct-self')
    const result = await caller.leavePreview({ groupId: 'grp-1' })

    expect(result.isLastAdmin).toBe(true)
    expect(result.isLastActiveMember).toBe(false)
    expect(result.otherAdmins).toEqual([])
    expect(result.promotableMembers).toEqual([
      { id: 'gm-other-member', name: 'Carol' },
    ])
  })

  it('flags isLastActiveMember=true when caller is the only active member', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 0,
      otherAdminCount: 0,
    })

    const caller = makeCaller('acct-self')
    const result = await caller.leavePreview({ groupId: 'grp-1' })

    expect(result.isLastActiveMember).toBe(true)
    expect(result.isLastAdmin).toBe(true)
  })

  it('reports hasUnsettledBalance=true when the caller has a non-zero balance', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 1,
      otherMembers: [
        {
          id: 'gm-other-admin',
          role: 'ADMIN',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })
    // Alice paid 100 for both — Bob owes 50, so Alice's balance is +50.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-self',
        paidFor: [
          { participantId: 'lp-self', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-self')
    const result = await caller.leavePreview({ groupId: 'grp-1' })

    expect(result.hasUnsettledBalance).toBe(true)
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
        .leavePreview({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('groupsRouter.leave — happy path', () => {
  it('lets a regular MEMBER leave when other admins exist', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'MEMBER',
      otherMemberCount: 1,
      otherAdminCount: 1,
      otherMembers: [
        {
          id: 'gm-other-admin',
          role: 'ADMIN',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })
    prismaMock.groupMember.update.mockResolvedValue({ id: 'gm-self' } as never)

    const caller = makeCaller('acct-self')
    const result = await caller.leave({ groupId: 'grp-1' })

    expect(result).toEqual({ deleted: false, promotedMemberId: null })
    expect(prismaMock.groupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gm-self' },
        data: expect.objectContaining({
          status: 'LEFT',
          leftAt: expect.any(Date),
        }),
      }),
    )
    expect(prisma$Transaction).toHaveBeenCalledTimes(1)
  })

  it('lets an ADMIN leave when other admins remain', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 1,
      otherMembers: [
        {
          id: 'gm-other-admin',
          role: 'ADMIN',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })
    prismaMock.groupMember.update.mockResolvedValue({ id: 'gm-self' } as never)

    const caller = makeCaller('acct-self')
    const result = await caller.leave({ groupId: 'grp-1' })

    expect(result).toEqual({ deleted: false, promotedMemberId: null })
    // The caller is flipped to LEFT but no promotion occurs.
    expect(prismaMock.groupMember.update).toHaveBeenCalledTimes(1)
  })
})

describe('groupsRouter.leave — last admin', () => {
  it('rejects a last-admin leave without promoteMemberId with PRECONDITION_FAILED', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 0,
      otherMembers: [
        {
          id: 'gm-other-member',
          role: 'MEMBER',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })

    const caller = makeCaller('acct-self')
    await expect(caller.leave({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
    expect(prisma$Transaction).not.toHaveBeenCalled()
  })

  it('promotes the chosen member when the last admin leaves', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 0,
      otherMembers: [
        {
          id: 'gm-other-member',
          role: 'MEMBER',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })
    prismaMock.groupMember.update.mockResolvedValue({ id: 'gm-self' } as never)

    const caller = makeCaller('acct-self')
    const result = await caller.leave({
      groupId: 'grp-1',
      promoteMemberId: 'gm-other-member',
    })

    expect(result).toEqual({
      deleted: false,
      promotedMemberId: 'gm-other-member',
    })
    // First update promotes Bob, second flips the caller to LEFT.
    expect(prismaMock.groupMember.update).toHaveBeenCalledTimes(2)
    expect(prismaMock.groupMember.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'gm-other-member' },
        data: { role: 'ADMIN' },
      }),
    )
    expect(prismaMock.groupMember.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'gm-self' },
        data: expect.objectContaining({ status: 'LEFT' }),
      }),
    )
  })

  it('rejects an invalid promoteMemberId with BAD_REQUEST', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 0,
      otherMembers: [
        {
          id: 'gm-other-member',
          role: 'MEMBER',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })

    const caller = makeCaller('acct-self')
    await expect(
      caller.leave({
        groupId: 'grp-1',
        promoteMemberId: 'gm-not-in-group',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
  })

  it('rejects promoting yourself with BAD_REQUEST', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 0,
      otherMembers: [
        {
          id: 'gm-other-member',
          role: 'MEMBER',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })

    const caller = makeCaller('acct-self')
    await expect(
      caller.leave({
        groupId: 'grp-1',
        promoteMemberId: 'gm-self',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
  })
})

describe('groupsRouter.leave — last active member', () => {
  it('rejects without confirmDelete with PRECONDITION_FAILED', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 0,
      otherAdminCount: 0,
    })

    const caller = makeCaller('acct-self')
    await expect(caller.leave({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    })
    expect(prismaMock.group.delete).not.toHaveBeenCalled()
  })

  it('deletes the group when confirmDelete=true', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 0,
      otherAdminCount: 0,
    })

    const caller = makeCaller('acct-self')
    const result = await caller.leave({
      groupId: 'grp-1',
      confirmDelete: true,
    })

    expect(result).toEqual({ deleted: true, promotedMemberId: null })
    expect(prismaMock.group.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'grp-1' } }),
    )
    // No membership flip and no promotion: the cascade handles it.
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
  })

  it('does not create settlement expenses when the caller has an unsettled balance and the group will be deleted', async () => {
    // The group is about to be cascade-deleted, so any settlement
    // expense we wrote would be removed along with everything else.
    // The caller is informed in the UI that the unsettled amount will
    // be lost, and the API silently skips the force-settlement step.
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 0,
      otherAdminCount: 0,
    })
    // Alice paid 100 for herself only — balanced for her, but the
    // caller's ledger participant has a non-zero row to trip the
    // settlement check. We use a self-only expense so the balance is
    // effectively zero for the algorithm but the participant row is
    // populated, which is enough to keep the early-return path intact.
    // To actually exercise the unsettled branch we use a real two-leg
    // expense below.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-self',
        paidFor: [
          { participantId: 'lp-self', shares: 1 },
          { participantId: 'lp-orphan', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-self')
    const result = await caller.leave({
      groupId: 'grp-1',
      confirmDelete: true,
      force: true,
    })

    expect(result).toEqual({ deleted: true, promotedMemberId: null })
    expect(prismaMock.group.delete).toHaveBeenCalled()
    // Force-settlement is a no-op when the group is being deleted.
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
})

describe('groupsRouter.leave — unsettled balances', () => {
  it('rejects a leave with PRECONDITION_FAILED when the caller has a non-zero balance and force is not set', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 1,
      otherMembers: [
        {
          id: 'gm-other-admin',
          role: 'ADMIN',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })
    // Alice paid 100 for both — Bob owes 50, Alice has +50.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-self',
        paidFor: [
          { participantId: 'lp-self', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-self')
    await expect(caller.leave({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })

  it('creates only the settlement legs involving the leaving user when force=true', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 2,
      otherAdminCount: 1,
      otherMembers: [
        { id: 'gm-bob', role: 'ADMIN', name: 'Bob', participantId: 'lp-bob' },
        {
          id: 'gm-carol',
          role: 'MEMBER',
          name: 'Carol',
          participantId: 'lp-carol',
        },
      ],
    })
    // Alice paid 60 for [Alice, Bob]: Alice +30, Bob -30.
    // Carol paid 30 for [Bob, Carol]: Carol +15, Bob -15.
    // Totals: Alice +30, Bob -45, Carol +15.
    // Greedy reimbursements:
    //   Bob -> Alice, $30  (involves Alice)
    //   Bob -> Carol, $15  (does NOT involve Alice)
    // Only the first leg involves Alice and should be written.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 60,
        paidById: 'lp-self',
        paidFor: [
          { participantId: 'lp-self', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
        ],
      }),
      makeExpenseRow({
        id: 'exp-2',
        amount: 30,
        paidById: 'lp-carol',
        paidFor: [
          { participantId: 'lp-bob', shares: 1 },
          { participantId: 'lp-carol', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      const data = (args as { data: { id: string } }).data
      return { id: data.id, ...(args as object) } as never
    })
    prismaMock.groupMember.update.mockResolvedValue({ id: 'gm-self' } as never)

    const caller = makeCaller('acct-self')
    await caller.leave({ groupId: 'grp-1', force: true })

    // Only the Bob -> Alice leg involves Alice and should be written;
    // the Bob -> Carol leg must be left alone.
    expect(prismaMock.expense.create).toHaveBeenCalledTimes(1)
    const createCall = prismaMock.expense.create.mock.calls[0][0] as {
      data: {
        title: string
        amount: number
        paidById: string
        paidFor: { createMany: { data: Array<{ shares: number }> } }
        isReimbursement: boolean
        categoryId: string
      }
    }
    expect(createCall.data.title).toBe('Settlement on leave')
    expect(createCall.data.amount).toBe(30)
    expect(createCall.data.paidById).toBe('lp-bob')
    expect(createCall.data.paidFor.createMany.data).toEqual([
      expect.objectContaining({ shares: 1 }),
    ])
    expect(createCall.data.isReimbursement).toBe(true)
    expect(createCall.data.categoryId).toBe('payment')
    expect(prisma$Transaction).toHaveBeenCalledTimes(1)
    // The settlement-on-leave activity is logged with the leaving user's
    // participant id so the activity feed renders their name instead of
    // falling back to "someone".
    const settlementActivityCall = prismaMock.activity.create.mock.calls.find(
      (call) =>
        (call[0] as { data: { data?: string } }).data?.data ===
        'Settlement on leave',
    )
    expect(settlementActivityCall).toBeDefined()
    expect(settlementActivityCall![0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          activityType: 'CREATE_EXPENSE',
          ledgerParticipantId: 'lp-self',
          data: 'Settlement on leave',
        }),
      }),
    )
  })

  it('writes a settlement expense for a leaving debtor with the debtor as payer', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 1,
      otherMembers: [
        { id: 'gm-bob', role: 'ADMIN', name: 'Bob', participantId: 'lp-bob' },
      ],
    })
    // Bob paid 100 for both. Alice owes Bob 50, so Alice has -50.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-bob',
        paidFor: [
          { participantId: 'lp-self', shares: 1 },
          { participantId: 'lp-bob', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      const data = (args as { data: { id: string } }).data
      return { id: data.id, ...(args as object) } as never
    })
    prismaMock.groupMember.update.mockResolvedValue({ id: 'gm-self' } as never)

    const caller = makeCaller('acct-self')
    await caller.leave({ groupId: 'grp-1', force: true })

    expect(prismaMock.expense.create).toHaveBeenCalledTimes(1)
    const createCall = prismaMock.expense.create.mock.calls[0][0] as {
      data: { amount: number; paidById: string }
    }
    expect(createCall.data.paidById).toBe('lp-self')
    expect(createCall.data.amount).toBe(50)
  })

  it('does not write any settlement expenses when force=true but the caller has a zero balance', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 1,
      otherMembers: [
        { id: 'gm-bob', role: 'ADMIN', name: 'Bob', participantId: 'lp-bob' },
      ],
    })
    // Each pays for themselves — settled.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 50,
        paidById: 'lp-self',
        paidFor: [{ participantId: 'lp-self', shares: 1 }],
      }),
      makeExpenseRow({
        id: 'exp-2',
        amount: 50,
        paidById: 'lp-bob',
        paidFor: [{ participantId: 'lp-bob', shares: 1 }],
      }),
    ] as never)
    prismaMock.groupMember.update.mockResolvedValue({ id: 'gm-self' } as never)

    const caller = makeCaller('acct-self')
    await caller.leave({ groupId: 'grp-1', force: true })

    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })
})

describe('groupsRouter.leave — guards', () => {
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
        .leave({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects a non-member caller with FORBIDDEN', async () => {
    await authAs('acct-outside')
    seedLeaveContext({
      callerRole: 'MEMBER',
      otherMemberCount: 1,
      otherAdminCount: 1,
      otherMembers: [
        {
          id: 'gm-other-admin',
          role: 'ADMIN',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })
    // `loadGroupContext` queries the caller's membership by `acct-outside`.
    // The default `findUnique` mock returns null for unknown ids, so the
    // authAs setup is enough.
    prismaMock.groupMember.findUnique.mockResolvedValue(null)

    const caller = makeCaller('acct-outside')
    await expect(caller.leave({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(prismaMock.group.delete).not.toHaveBeenCalled()
  })

  it('rejects leaving an archived group with FORBIDDEN', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 1,
      otherMembers: [
        {
          id: 'gm-other-admin',
          role: 'ADMIN',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
      archived: true,
    })

    const caller = makeCaller('acct-self')
    await expect(caller.leave({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(prismaMock.group.delete).not.toHaveBeenCalled()
  })
})

describe('groupsRouter.archiveForSelf', () => {
  it('archives the group and sets the per-account hide preference when the caller is the last active member', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 0,
      otherAdminCount: 0,
    })
    prismaMock.group.update.mockResolvedValue({
      id: 'grp-1',
      archived: true,
    } as never)
    prismaMock.accountGroupPreference.upsert.mockResolvedValue({
      id: 'pref-1',
    } as never)

    const caller = makeCaller('acct-self')
    const result = await caller.archiveForSelf({ groupId: 'grp-1' })

    expect(result).toEqual({ archived: true })
    // Group flipped to archived...
    expect(prismaMock.group.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grp-1' },
        data: { archived: true },
      }),
    )
    // ...and the per-account hide preference is upserted.
    expect(prismaMock.accountGroupPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_groupId: { accountId: 'acct-self', groupId: 'grp-1' },
        },
        update: { archived: true },
        create: expect.objectContaining({
          archived: true,
          accountId: 'acct-self',
          groupId: 'grp-1',
        }),
      }),
    )
    // Membership is preserved — archiveForSelf is the alternative to
    // leaving, not a way to leave.
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
    // The whole operation is wrapped in a transaction so the global
    // archive flag, the per-account preference, and the activity log
    // commit atomically.
    expect(prisma$Transaction).toHaveBeenCalledTimes(1)
    // The group itself is not deleted.
    expect(prismaMock.group.delete).not.toHaveBeenCalled()
    // The archive-on-leave activity is logged with the caller's
    // participant id so the activity feed renders their name instead of
    // falling back to "someone".
    const archiveActivityCall = prismaMock.activity.create.mock.calls.find(
      (call) =>
        (call[0] as { data: { data?: string } }).data?.data ===
        'group:archived-on-leave',
    )
    expect(archiveActivityCall).toBeDefined()
    expect(archiveActivityCall![0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          activityType: 'UPDATE_GROUP',
          ledgerParticipantId: 'lp-self',
          data: 'group:archived-on-leave',
        }),
      }),
    )
  })

  it('rejects archiveForSelf with BAD_REQUEST when other active members exist', async () => {
    await authAs('acct-self')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 1,
      otherAdminCount: 1,
      otherMembers: [
        {
          id: 'gm-other-admin',
          role: 'ADMIN',
          name: 'Bob',
          participantId: 'lp-bob',
        },
      ],
    })

    const caller = makeCaller('acct-self')
    await expect(
      caller.archiveForSelf({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prismaMock.group.update).not.toHaveBeenCalled()
    expect(prismaMock.accountGroupPreference.upsert).not.toHaveBeenCalled()
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
        .archiveForSelf({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects a non-member caller with FORBIDDEN', async () => {
    await authAs('acct-outside')
    seedLeaveContext({
      callerRole: 'ADMIN',
      otherMemberCount: 0,
      otherAdminCount: 0,
    })
    prismaMock.groupMember.findUnique.mockResolvedValue(null)

    const caller = makeCaller('acct-outside')
    await expect(
      caller.archiveForSelf({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.group.update).not.toHaveBeenCalled()
  })
})
