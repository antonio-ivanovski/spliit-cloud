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
})
