import { describe, expect, it } from 'vitest'
import '../../../../test/mocks'
import {
  authState,
  prisma$Transaction,
  prismaMock,
} from '../../../../test/state'
import { createTRPCContext } from '../../../init'
import { groupsRouter } from '../index'

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
}

type Role = 'ADMIN' | 'MEMBER'

function mockGroupContext(opts: {
  callerMemberId: string
  callerRole: Role
  callerAccountId?: string
  archived?: boolean
}) {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-1',
    ledgerId: 'ledger-1',
    archived: opts.archived ?? false,
    ledger: { id: 'ledger-1' },
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue({
    id: opts.callerMemberId,
    groupId: 'grp-1',
    accountId: opts.callerAccountId ?? 'acct-caller',
    role: opts.callerRole,
    status: 'ACTIVE',
    ledgerParticipant: null,
  } as never)
  // `removeMember` (and the preview query) now goes through
  // `getGroupBalances` → `getGroupExpenses` → `createRecurringExpenses`
  // whenever the target has a ledger participant. Default to empty
  // results so the existing "no balances" tests don't have to set up
  // these mocks themselves.
  prismaMock.recurringExpenseLink.findMany.mockResolvedValue([] as never)
  prismaMock.expense.findMany.mockResolvedValue([] as never)
}

describe('groupsRouter.members.updateRole', () => {
  it('allows an ADMIN to promote a MEMBER', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (
        args as { where: { id?: string; groupId_accountId?: unknown } }
      ).where
      if (where.id === 'gm-target') {
        return {
          id: 'gm-target',
          groupId: 'grp-1',
          accountId: 'acct-target',
          role: 'MEMBER',
          status: 'ACTIVE',
          ledgerParticipant: null,
        } as never
      }
      return {
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-target',
    } as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.members.updateRole({
      groupId: 'grp-1',
      memberId: 'gm-target',
      role: 'ADMIN',
    })

    expect(result).toEqual({ memberId: 'gm-target', role: 'ADMIN' })
    expect(prismaMock.groupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gm-target' },
        data: { role: 'ADMIN' },
      }),
    )
  })

  it('allows an ADMIN to demote another ADMIN', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin-1', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-admin-2') {
        return {
          id: 'gm-admin-2',
          groupId: 'grp-1',
          accountId: 'acct-other',
          role: 'ADMIN',
          status: 'ACTIVE',
          ledgerParticipant: null,
        } as never
      }
      return {
        id: 'gm-admin-1',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    prismaMock.groupMember.count.mockResolvedValue(1 as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-admin-2',
    } as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.members.updateRole({
      groupId: 'grp-1',
      memberId: 'gm-admin-2',
      role: 'MEMBER',
    })

    expect(result.role).toBe('MEMBER')
    // The last-admin guard runs a count query for active admins excluding
    // the target — we expect it to be called and to pass before update.
    expect(prismaMock.groupMember.count).toHaveBeenCalled()
  })

  it('rejects a MEMBER with FORBIDDEN', async () => {
    await authAs('acct-member')
    mockGroupContext({ callerMemberId: 'gm-member', callerRole: 'MEMBER' })

    const caller = makeCaller('acct-member')
    await expect(
      caller.members.updateRole({
        groupId: 'grp-1',
        memberId: 'gm-target',
        role: 'ADMIN',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
  })

  it('rejects demoting the last admin with PRECONDITION_FAILED', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin-1', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-admin-2') {
        return {
          id: 'gm-admin-2',
          groupId: 'grp-1',
          accountId: 'acct-other',
          role: 'ADMIN',
          status: 'ACTIVE',
          ledgerParticipant: null,
        } as never
      }
      return {
        id: 'gm-admin-1',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    // No other admin in the group.
    prismaMock.groupMember.count.mockResolvedValue(0 as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.members.updateRole({
        groupId: 'grp-1',
        memberId: 'gm-admin-2',
        role: 'MEMBER',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
  })

  it('rejects an admin changing their own role with BAD_REQUEST', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-self', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      // Caller lookup and target lookup both return the same row.
      return {
        id: 'gm-self',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.members.updateRole({
        groupId: 'grp-1',
        memberId: 'gm-self',
        role: 'MEMBER',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
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
        .members.updateRole({
          groupId: 'grp-1',
          memberId: 'gm-target',
          role: 'ADMIN',
        }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('groupsRouter.members.remove', () => {
  it('allows an ADMIN to remove a MEMBER', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-target') {
        return {
          id: 'gm-target',
          groupId: 'grp-1',
          accountId: 'acct-target',
          role: 'MEMBER',
          status: 'ACTIVE',
          ledgerParticipant: null,
        } as never
      }
      return {
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-target',
    } as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.members.remove({
      groupId: 'grp-1',
      memberId: 'gm-target',
    })

    expect(result).toEqual({ memberId: 'gm-target' })
    expect(prismaMock.groupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gm-target' },
        data: expect.objectContaining({ status: 'REMOVED' }),
      }),
    )
  })

  it('rejects a MEMBER with FORBIDDEN', async () => {
    await authAs('acct-member')
    mockGroupContext({ callerMemberId: 'gm-member', callerRole: 'MEMBER' })

    const caller = makeCaller('acct-member')
    await expect(
      caller.members.remove({ groupId: 'grp-1', memberId: 'gm-target' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
  })

  it('rejects removing the last admin with PRECONDITION_FAILED', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin-1', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-admin-2') {
        return {
          id: 'gm-admin-2',
          groupId: 'grp-1',
          accountId: 'acct-other',
          role: 'ADMIN',
          status: 'ACTIVE',
          ledgerParticipant: null,
        } as never
      }
      return {
        id: 'gm-admin-1',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    prismaMock.groupMember.count.mockResolvedValue(0 as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.members.remove({ groupId: 'grp-1', memberId: 'gm-admin-2' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
  })

  it('rejects removing yourself with BAD_REQUEST', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-self', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      return {
        id: 'gm-self',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.members.remove({ groupId: 'grp-1', memberId: 'gm-self' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
  })

  it('rejects the mutation on an archived group', async () => {
    await authAs('acct-admin')
    mockGroupContext({
      callerMemberId: 'gm-admin',
      callerRole: 'ADMIN',
      archived: true,
    })

    const caller = makeCaller('acct-admin')
    await expect(
      caller.members.remove({ groupId: 'grp-1', memberId: 'gm-target' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
  })

  it('runs the membership update and activity log inside a transaction', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-target') {
        return {
          id: 'gm-target',
          groupId: 'grp-1',
          accountId: 'acct-target',
          role: 'MEMBER',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'lp-target' },
        } as never
      }
      return {
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-target',
    } as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = makeCaller('acct-admin')
    await caller.members.remove({ groupId: 'grp-1', memberId: 'gm-target' })

    expect(prisma$Transaction).toHaveBeenCalledTimes(1)
  })

  it('rejects PRECONDITION_FAILED when the target has unsettled balances and no decision is supplied', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-target') {
        return {
          id: 'gm-target',
          groupId: 'grp-1',
          accountId: 'acct-target',
          role: 'MEMBER',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'lp-target' },
        } as never
      }
      return {
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    // Target paid for both, so they have a non-zero balance and the
    // mutation must refuse without an explicit settlement decision.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-target',
        paidFor: [
          { participantId: 'lp-target', shares: 1 },
          { participantId: 'lp-admin', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.members.remove({ groupId: 'grp-1', memberId: 'gm-target' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(prismaMock.groupMember.update).not.toHaveBeenCalled()
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })

  it('creates settlement expenses for the target before removing when settleBalances=true', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-target') {
        return {
          id: 'gm-target',
          groupId: 'grp-1',
          accountId: 'acct-target',
          role: 'MEMBER',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'lp-target' },
        } as never
      }
      return {
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    // Target paid 100 for both: target +50, admin -50. Only one leg
    // involves the target, so exactly one settlement expense is written.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-target',
        paidFor: [
          { participantId: 'lp-target', shares: 1 },
          { participantId: 'lp-admin', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      const data = (args as { data: { id: string } }).data
      return { id: data.id, ...(args as object) } as never
    })
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-target',
    } as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = makeCaller('acct-admin')
    await caller.members.remove({
      groupId: 'grp-1',
      memberId: 'gm-target',
      settleBalances: true,
    })

    expect(prismaMock.expense.create).toHaveBeenCalledTimes(1)
    const createCall = prismaMock.expense.create.mock.calls[0][0] as {
      data: { title: string; paidById: string; amount: number }
    }
    expect(createCall.data.title).toBe('Settlement on leave')
    expect(createCall.data.paidById).toBe('lp-admin')
    expect(createCall.data.amount).toBe(50)
    expect(prismaMock.groupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gm-target' },
        data: expect.objectContaining({ status: 'REMOVED' }),
      }),
    )
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ data: 'member:removed:settled' }),
      }),
    )
    // The settlement-on-leave activity is logged with the leaving
    // member's participant id so the activity feed renders their name
    // instead of falling back to "someone".
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
          ledgerParticipantId: 'lp-target',
          data: 'Settlement on leave',
        }),
      }),
    )
  })

  it('removes without touching balances when settleBalances=false even if the target has unsettled balances', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-target') {
        return {
          id: 'gm-target',
          groupId: 'grp-1',
          accountId: 'acct-target',
          role: 'MEMBER',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'lp-target' },
        } as never
      }
      return {
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-target',
        paidFor: [
          { participantId: 'lp-target', shares: 1 },
          { participantId: 'lp-admin', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-target',
    } as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = makeCaller('acct-admin')
    await caller.members.remove({
      groupId: 'grp-1',
      memberId: 'gm-target',
      settleBalances: false,
    })

    expect(prismaMock.expense.create).not.toHaveBeenCalled()
    expect(prismaMock.groupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gm-target' },
        data: expect.objectContaining({ status: 'REMOVED' }),
      }),
    )
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ data: 'member:removed' }),
      }),
    )
  })
})

/**
 * Build a single "expense" record as `getGroupExpenses` would return it
 * after the row is materialised by Prisma. Mirrors the shape used in
 * `leave.test.ts` so the balance pipeline runs end-to-end on the mock
 * prisma client.
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

describe('groupsRouter.members.removePreview', () => {
  it('reports hasUnsettledBalance=true when the target has a non-zero balance', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-target') {
        return {
          id: 'gm-target',
          groupId: 'grp-1',
          accountId: 'acct-target',
          role: 'MEMBER',
          status: 'ACTIVE',
          account: { id: 'acct-target', name: 'Target' },
          ledgerParticipant: { id: 'lp-target' },
        } as never
      }
      return {
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-target',
        paidFor: [
          { participantId: 'lp-target', shares: 1 },
          { participantId: 'lp-admin', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.members.removePreview({
      groupId: 'grp-1',
      memberId: 'gm-target',
    })

    expect(result.memberName).toBe('Target')
    expect(result.hasUnsettledBalance).toBe(true)
  })

  it('reports hasUnsettledBalance=false when the target is fully settled', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin', callerRole: 'ADMIN' })
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-target') {
        return {
          id: 'gm-target',
          groupId: 'grp-1',
          accountId: 'acct-target',
          role: 'MEMBER',
          status: 'ACTIVE',
          account: { id: 'acct-target', name: 'Target' },
          ledgerParticipant: { id: 'lp-target' },
        } as never
      }
      return {
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)
    // Each pays for themselves — settled.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 50,
        paidById: 'lp-target',
        paidFor: [{ participantId: 'lp-target', shares: 1 }],
      }),
      makeExpenseRow({
        id: 'exp-2',
        amount: 50,
        paidById: 'lp-admin',
        paidFor: [{ participantId: 'lp-admin', shares: 1 }],
      }),
    ] as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.members.removePreview({
      groupId: 'grp-1',
      memberId: 'gm-target',
    })

    expect(result.hasUnsettledBalance).toBe(false)
  })

  it('rejects a non-admin caller with FORBIDDEN', async () => {
    await authAs('acct-member')
    mockGroupContext({ callerMemberId: 'gm-member', callerRole: 'MEMBER' })

    const caller = makeCaller('acct-member')
    await expect(
      caller.members.removePreview({
        groupId: 'grp-1',
        memberId: 'gm-target',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects an unknown member with NOT_FOUND', async () => {
    await authAs('acct-admin')
    mockGroupContext({ callerMemberId: 'gm-admin', callerRole: 'ADMIN' })
    // The procedure looks up the caller (`loadGroupContext`) and then the
    // target by id. Returning null for the target while keeping the
    // caller lookup working triggers the "Member not found in this group"
    // branch which maps to NOT_FOUND.
    prismaMock.groupMember.findUnique.mockImplementation((async (
      args: unknown,
    ) => {
      const where = (args as { where: { id?: string } }).where
      if (where.id === 'gm-unknown') return null
      return {
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never
    }) as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.members.removePreview({
        groupId: 'grp-1',
        memberId: 'gm-unknown',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
