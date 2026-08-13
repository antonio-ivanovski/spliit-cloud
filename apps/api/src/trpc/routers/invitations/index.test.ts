import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import {
  authState,
  prisma$Transaction,
  prismaMock,
  sendEmailMock,
} from '../../../test/state'
import { createTRPCContext } from '../../init'
import { invitationsRouter } from './index'

function makeCaller(authUserId: string) {
  // Build a minimal `ctx.auth` payload; the test factories in `state.ts`
  // already provide a refresh hook so `getAuthFromRequest` will return this
  // account.
  return invitationsRouter.createCaller({
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

describe('invitationsRouter.list', () => {
  // `list` resolves recipient profiles with one bulk account lookup.
  beforeEach(() => {
    prismaMock.account.findMany.mockResolvedValue([] as never)
  })

  it('returns the invitations list for an ADMIN', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        groupId: 'grp-1',
        email: 'bob@example.com',
        role: 'MEMBER',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const caller = makeCaller('acct-admin')
    const result = await caller.list({ groupId: 'grp-1' })

    expect(result.invitations).toHaveLength(1)
    expect(result.invitations[0]).toMatchObject({ id: 'inv-1' })
  })

  it('returns the invitations list for an ADMIN', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([])

    const caller = makeCaller('acct-admin')
    const result = await caller.list({ groupId: 'grp-1' })

    expect(result.invitations).toEqual([])
  })

  it('returns only invitations created by a MEMBER', async () => {
    await authAs('acct-member')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-member',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-own',
        groupId: 'grp-1',
        email: 'bob@example.com',
        type: 'EMAIL',
        temporaryName: null,
        role: 'MEMBER',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        ledgerParticipantId: null,
        invitedById: 'acct-member',
      },
      {
        id: 'inv-other',
        groupId: 'grp-1',
        email: 'eve@example.com',
        type: 'EMAIL',
        temporaryName: null,
        role: 'MEMBER',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        ledgerParticipantId: null,
        invitedById: 'acct-admin',
      },
    ] as never)

    const caller = makeCaller('acct-member')
    const result = await caller.list({ groupId: 'grp-1' })
    expect(result.invitations).toEqual([
      expect.objectContaining({ id: 'inv-own', canRevoke: true }),
    ])
  })

  it('computes member revocation capabilities with one balance load', async () => {
    await authAs('acct-member')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
      archived: false,
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-member',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-unused',
        groupId: 'grp-1',
        email: 'unused@example.com',
        type: 'EMAIL',
        temporaryName: null,
        role: 'MEMBER',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        ledgerParticipantId: 'lp-unused',
        invitedById: 'acct-member',
      },
      {
        id: 'inv-used',
        groupId: 'grp-1',
        email: 'used@example.com',
        type: 'EMAIL',
        temporaryName: null,
        role: 'MEMBER',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        ledgerParticipantId: 'lp-used',
        invitedById: 'acct-member',
      },
    ] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-unused',
        _count: {
          expensesPaidByList: 0,
          expensesPaidFor: 0,
          expenseItemPaidFor: 0,
          expenseItemizedRemainderPaidFor: 0,
        },
      },
      {
        id: 'lp-used',
        _count: {
          expensesPaidByList: 1,
          expensesPaidFor: 0,
          expenseItemPaidFor: 0,
          expenseItemizedRemainderPaidFor: 0,
        },
      },
    ] as never)
    prismaMock.expense.findMany.mockResolvedValue([])

    const result = await makeCaller('acct-member').list({ groupId: 'grp-1' })

    expect(result.invitations).toEqual([
      expect.objectContaining({ id: 'inv-unused', canRevoke: true }),
      expect.objectContaining({ id: 'inv-used', canRevoke: false }),
    ])
    expect(prismaMock.ledgerParticipant.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.expense.findMany).toHaveBeenCalledTimes(1)
  })

  it('keeps an expired PENDING link invitation listed and manageable', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-expired-link',
        groupId: 'grp-1',
        email: 'aGVsbG8@link.placeholder.local',
        type: 'LINK',
        temporaryName: 'Old Guest',
        role: 'MEMBER',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000 * 60 * 60),
        ledgerParticipantId: 'lp-old',
        invitedById: 'acct-admin',
      },
    ] as never)

    const result = await makeCaller('acct-admin').list({ groupId: 'grp-1' })

    expect(result.invitations).toHaveLength(1)
    expect(result.invitations[0]).toMatchObject({
      id: 'inv-expired-link',
      status: 'PENDING',
      canManage: true,
      canRevoke: true,
      expiresAt: expect.any(Date) as Date,
    })
  })

  it('rejects a non-member with FORBIDDEN', async () => {
    await authAs('acct-outside')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue(null)

    const caller = makeCaller('acct-outside')
    await expect(caller.list({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects an unauthenticated caller with UNAUTHORIZED', async () => {
    authState.session = null
    const ctx = await createTRPCContext({
      req: new Request('http://localhost/api/test'),
    })

    await expect(
      invitationsRouter
        .createCaller({
          auth: ctx.auth,
        } as never)
        .list({ groupId: 'grp-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('invitationsRouter.create', () => {
  it('creates an invitation for an ADMIN', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.create.mockResolvedValue({
      id: 'inv-new',
      email: 'bob@example.com',
      temporaryName: null,
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.create({
      requestId: crypto.randomUUID(),
      groupId: 'grp-1',
      email: 'bob@example.com',
      role: 'MEMBER',
    })

    expect(result.invitationId).toBe('inv-new')
    expect(prismaMock.groupInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          groupId: 'grp-1',
          email: 'bob@example.com',
          invitedById: 'acct-admin',
          role: 'MEMBER',
        }),
      }),
    )
  })

  it('lets a MEMBER create a MEMBER invitation', async () => {
    await authAs('acct-member')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-member',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.create.mockResolvedValue({
      id: 'inv-member',
      email: 'bob@example.com',
      temporaryName: null,
    } as never)

    const caller = makeCaller('acct-member')
    const result = await caller.create({
      requestId: crypto.randomUUID(),
      groupId: 'grp-1',
      email: 'bob@example.com',
      role: 'MEMBER',
    })
    expect(result.invitationId).toBe('inv-member')
  })

  it('rejects an ADMIN invitation created by a MEMBER', async () => {
    await authAs('acct-member')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-member',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)

    await expect(
      makeCaller('acct-member').create({
        requestId: crypto.randomUUID(),
        groupId: 'grp-1',
        email: 'bob@example.com',
        role: 'ADMIN',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('invitationsRouter.accept', () => {
  it('accepts a pending invitation for the matching account email', async () => {
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'BOB@example.com',
      emailVerified: true,
      name: 'Bob',
    })
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'EMAIL',
      email: 'bob@example.com',
      status: 'PENDING',
      role: 'MEMBER',
      group: {
        id: 'grp-1',
        ledger: { id: 'ledger-1' },
      },
    } as never)

    const txMock = prisma$Transaction
    txMock.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (tx: unknown) => unknown)(prismaMock)
      }
      return undefined
    })
    prismaMock.groupMember.upsert.mockResolvedValue({
      id: 'gm-bob',
      groupId: 'grp-1',
      accountId: 'acct-bob',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.upsert.mockResolvedValue({} as never)
    prismaMock.groupInvitation.update.mockResolvedValue({} as never)

    const caller = invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-bob' },
        user: {
          id: 'acct-bob',
          email: 'bob@example.com',
          emailVerified: true,
          name: 'Bob',
        },
      },
    } as never)
    const result = await caller.accept({ invitationId: 'inv-1' })

    expect(result.groupId).toBe('grp-1')
  })

  it('rejects acceptance when the email does not match', async () => {
    authState.session = {
      user: { id: 'acct-eve' },
      session: { id: 'sess-eve' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-eve',
      email: 'eve@example.com',
      emailVerified: true,
      name: 'Eve',
    })
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'EMAIL',
      email: 'bob@example.com',
      status: 'PENDING',
      role: 'MEMBER',
      group: { id: 'grp-1', ledger: { id: 'ledger-1' } },
    } as never)

    const caller = makeCaller('acct-eve')
    await expect(caller.accept({ invitationId: 'inv-1' })).rejects.toThrow(
      /email does not match/i,
    )
  })

  it('rejects acceptance when the invitation is no longer pending', async () => {
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'bob@example.com',
      emailVerified: true,
      name: 'Bob',
    })
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'EMAIL',
      email: 'bob@example.com',
      status: 'REVOKED',
      role: 'MEMBER',
      group: { id: 'grp-1', ledger: { id: 'ledger-1' } },
    } as never)

    const caller = makeCaller('acct-bob')
    await expect(caller.accept({ invitationId: 'inv-1' })).rejects.toThrow(
      /no longer pending/i,
    )
  })

  it('re-invites a previously-removed member without unique-constraint failure', async () => {
    // Mirrors the link-invite re-invite case: the member already has
    // a `LedgerParticipant` from a prior membership, so the new
    // pending placeholder must be discarded.
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'bob@example.com',
      emailVerified: true,
      name: 'Bob',
    })
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'EMAIL',
      email: 'bob@example.com',
      status: 'PENDING',
      role: 'MEMBER',
      ledgerParticipantId: 'lp-new',
      group: { id: 'grp-1', ledger: { id: 'ledger-1' } },
    } as never)
    prismaMock.groupMember.upsert.mockResolvedValue({
      id: 'gm-bob',
      groupId: 'grp-1',
      accountId: 'acct-bob',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-old',
      groupMemberId: 'gm-bob',
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.expense.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.expensePaidFor.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.ledgerParticipant.delete.mockResolvedValue({} as never)
    prismaMock.groupInvitation.update.mockResolvedValue({} as never)

    const txMock = prisma$Transaction
    txMock.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (tx: unknown) => unknown)(prismaMock)
      }
      return undefined
    })

    const caller = invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-bob' },
        user: {
          id: 'acct-bob',
          email: 'bob@example.com',
          emailVerified: true,
          name: 'Bob',
        },
      },
    } as never)
    const result = await caller.accept({ invitationId: 'inv-1' })

    expect(result.groupId).toBe('grp-1')
    expect(prismaMock.ledgerParticipant.delete).toHaveBeenCalledWith({
      where: { id: 'lp-new' },
    })
    expect(prismaMock.ledgerParticipant.update).not.toHaveBeenCalled()
  })
})

describe('invitationsRouter.create — guards and email', () => {
  it('rejects a legacy OWNER role at the schema level', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.create({
        requestId: crypto.randomUUID(),
        groupId: 'grp-1',
        email: 'bob@example.com',
        // Cast to bypass TS for testing the runtime schema validation.
        role: 'OWNER' as 'MEMBER',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects a self-invite (inviter email matches invitee email)', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.create({
        requestId: crypto.randomUUID(),
        groupId: 'grp-1',
        // The inviter's email per `authAs` is 'alice@example.com'.
        email: 'ALICE@example.com',
        role: 'MEMBER',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/cannot invite yourself/i),
    })
    expect(prismaMock.groupInvitation.create).not.toHaveBeenCalled()
  })

  it('rejects inviting a person who is already a group member', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupMember.findFirst.mockResolvedValue({
      id: 'gm-existing',
    } as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.create({
        requestId: crypto.randomUUID(),
        groupId: 'grp-1',
        email: 'bob@example.com',
        role: 'MEMBER',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/already a member/i),
    })
    expect(prismaMock.groupInvitation.create).not.toHaveBeenCalled()
  })

  it('rejects a duplicate pending invitation for the same email and group', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    // First findFirst (existing member) → null; second (pending dup) → existing.
    const findFirstResponses = [null, { id: 'inv-existing' }]
    prismaMock.groupMember.findFirst.mockResolvedValue(
      findFirstResponses[0] as never,
    )
    prismaMock.groupInvitation.findFirst.mockImplementation((async (
      args: unknown,
    ) => {
      const a = args as { where?: { status?: string } }
      if (a.where?.status === 'PENDING') {
        return findFirstResponses[1] as never
      }
      return null
    }) as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.create({
        requestId: crypto.randomUUID(),
        groupId: 'grp-1',
        email: 'bob@example.com',
        role: 'MEMBER',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/already pending/i),
    })
    expect(prismaMock.groupInvitation.create).not.toHaveBeenCalled()
  })

  it('allows re-inviting an email with a previously accepted invitation when the member is no longer active', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupMember.findFirst.mockResolvedValue(null)
    prismaMock.groupInvitation.create.mockResolvedValue({
      id: 'inv-new-1',
      email: 'bob@example.com',
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.create({
      requestId: crypto.randomUUID(),
      groupId: 'grp-1',
      email: 'bob@example.com',
      role: 'MEMBER',
    })
    expect(result).toMatchObject({ invitationId: 'inv-new-1' })
    expect(prismaMock.groupInvitation.create).toHaveBeenCalled()
  })

  it('routes existing-account invitations through notifications instead of transactional email', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Roadtrip 2026',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.create.mockResolvedValue({
      id: 'inv-new',
      email: 'bob@example.com',
      groupId: 'grp-1',
    } as never)
    prismaMock.account.findFirst.mockResolvedValue({
      id: 'acct-bob',
      name: 'Bob Profile',
    } as never)

    const caller = makeCaller('acct-admin')
    await caller.create({
      requestId: crypto.randomUUID(),
      groupId: 'grp-1',
      email: 'bob@example.com',
      role: 'MEMBER',
      temporaryName: 'Submitted Name',
    })

    expect(sendEmailMock).not.toHaveBeenCalled()
    // Profile name is authoritative on create too, matching the manage path.
    expect(prismaMock.groupInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'bob@example.com',
          temporaryName: 'Bob Profile',
        }),
      }),
    )
    expect(prismaMock.ledgerParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ displayName: 'Bob Profile' }),
      }),
    )
  })

  it('sends a "sign-up" invitation email when the recipient has no account', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Roadtrip 2026',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.create.mockResolvedValue({
      id: 'inv-new',
      email: 'newuser@example.com',
      groupId: 'grp-1',
    } as never)
    // prismaMock.account.findFirst returns null by default → no account.

    const caller = makeCaller('acct-admin')
    await caller.create({
      requestId: crypto.randomUUID(),
      groupId: 'grp-1',
      email: 'newuser@example.com',
      role: 'MEMBER',
    })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0][0]
    expect(call.to).toBe('newuser@example.com')
    expect(call.subject).toContain('Roadtrip 2026')
    expect(call.text).toMatch(/create an account/i)
    expect(call.text).toContain('/?invitation=inv-new')
  })
})

describe('invitationsRouter.decline', () => {
  function buildDeclineCaller(accountId: string, email: string) {
    return invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-x' },
        user: { id: accountId, email, emailVerified: true, name: 'X' },
      },
    } as never)
  }

  it('marks a pending invitation as declined when the email matches', async () => {
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'EMAIL',
      email: 'bob@example.com',
      status: 'PENDING',
      role: 'MEMBER',
    } as never)
    prismaMock.groupInvitation.update.mockResolvedValue({
      id: 'inv-1',
      status: 'DECLINED',
    } as never)

    const caller = buildDeclineCaller('acct-bob', 'BOB@example.com')
    const result = await caller.decline({ invitationId: 'inv-1' })

    expect(result).toEqual({})
    expect(prismaMock.groupInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: { status: 'DECLINED' },
      }),
    )
  })

  it('removes a declined invitee from its subgroup in the same transaction', async () => {
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'EMAIL',
      email: 'bob@example.com',
      status: 'PENDING',
      role: 'MEMBER',
      ledgerParticipantId: 'lp-bob',
    } as never)
    prismaMock.groupInvitation.update.mockResolvedValue({
      id: 'inv-1',
      status: 'DECLINED',
    } as never)
    prismaMock.subgroupMember.findUnique.mockResolvedValue({
      subgroupId: 'sg-couple',
    } as never)
    prismaMock.subgroupMember.count.mockResolvedValue(1)

    const caller = buildDeclineCaller('acct-bob', 'bob@example.com')
    await caller.decline({ invitationId: 'inv-1' })

    expect(prismaMock.subgroupMember.delete).toHaveBeenCalledWith({
      where: {
        subgroupId_ledgerParticipantId: {
          subgroupId: 'sg-couple',
          ledgerParticipantId: 'lp-bob',
        },
      },
    })
    expect(prismaMock.subgroup.delete).toHaveBeenCalledWith({
      where: { id: 'sg-couple' },
    })
  })

  it('rejects a decline from an account whose email does not match', async () => {
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'EMAIL',
      email: 'bob@example.com',
      status: 'PENDING',
      role: 'MEMBER',
    } as never)

    const caller = buildDeclineCaller('acct-eve', 'eve@example.com')
    await expect(
      caller.decline({ invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prismaMock.groupInvitation.update).not.toHaveBeenCalled()
  })

  it('rejects declining a non-pending invitation', async () => {
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'EMAIL',
      email: 'bob@example.com',
      status: 'ACCEPTED',
      role: 'MEMBER',
    } as never)

    const caller = buildDeclineCaller('acct-bob', 'bob@example.com')
    await expect(
      caller.decline({ invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects an unauthenticated caller with UNAUTHORIZED', async () => {
    authState.session = null
    const ctx = await createTRPCContext({
      req: new Request('http://localhost/api/test'),
    })

    await expect(
      invitationsRouter
        .createCaller({
          auth: ctx.auth,
        } as never)
        .decline({ invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

/**
 * Build the prisma stubs the revoke procedure needs: - resolve the group
 * context for the caller (`loadGroupContext`), - resolve the invitation by id
 * (the pre-check + transaction both query it), - empty recurring-expense +
 * expense stubs so `getGroupBalances` doesn't hit the `null is not iterable`
 * path used by other helper flows.
 *
 * `invitationStatus` defaults to PENDING so the normal happy path doesn't have
 * to opt in. `participantId` controls whether the invitation has a materialized
 * ledger participant (real invitees always do once the invitee appears as
 * paid-by / paid-for on an expense).
 */
function seedRevokeContext(args: {
  callerRole?: 'ADMIN' | 'MEMBER'
  invitationStatus?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'DECLINED'
  participantId?: string | null
  invitationId?: string
  groupId?: string
  ledgerId?: string
  invitedById?: string
}) {
  const groupId = args.groupId ?? 'grp-1'
  const ledgerId = args.ledgerId ?? 'ledger-1'
  const invitationId = args.invitationId ?? 'inv-1'
  const invitationStatus = args.invitationStatus ?? 'PENDING'
  const participantId = args.participantId ?? null
  const callerRole = args.callerRole ?? 'ADMIN'

  prismaMock.group.findUnique.mockResolvedValue({
    id: groupId,
    ledgerId,
    ledger: { id: ledgerId },
    archived: false,
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue({
    id: 'gm-caller',
    groupId,
    accountId: 'acct-caller',
    role: callerRole,
    status: 'ACTIVE',
    ledgerParticipant: null,
  } as never)
  prismaMock.groupInvitation.findUnique.mockResolvedValue({
    id: invitationId,
    groupId,
    email: 'bob@example.com',
    role: 'MEMBER',
    status: invitationStatus,
    ledgerParticipantId: participantId,
    invitedById: args.invitedById ?? 'acct-admin',
    group: { groupType: 'GROUP' },
  } as never)
  prismaMock.groupInvitation.update.mockResolvedValue({
    id: invitationId,
    status: 'REVOKED',
    revokedAt: new Date(),
  } as never)
  prismaMock.expense.findMany.mockResolvedValue([] as never)
  return { groupId, ledgerId, invitationId, participantId }
}

/**
 * Build a single "expense" record as `getGroupExpenses` would return it after
 * the row is materialised by Prisma. Mirrors the shape used in
 * `members/index.test.ts` so the balance pipeline runs end-to-end on the mock
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
    ledgerId: 'ledger-1',
    amount: args.amount,
    createdAt: new Date(),
    expenseDate: new Date(),
    categoryId: 'general',
    splitMode: 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    recurrenceSequence: null,
    paidByList: [{ shares: args.amount, ledgerParticipantId: args.paidById }],
    paidFor: args.paidFor.map((pf) => ({
      shares: pf.shares,
      ledgerParticipantId: pf.participantId,
    })),
    items: [],
    itemizedRemainder: null,
    recurringSeries: null,
  }
}

describe('invitationsRouter.revokePreview', () => {
  it('reports hasUnsettledBalance=true when the invitee has a non-zero balance', async () => {
    await authAs('acct-admin')
    seedRevokeContext({ participantId: 'lp-invitee' })
    // Invitee paid 100 for [invitee, caller]: invitee +50, caller -50.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-invitee',
        paidFor: [
          { participantId: 'lp-invitee', shares: 1 },
          { participantId: 'lp-caller', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.revokePreview({
      groupId: 'grp-1',
      invitationId: 'inv-1',
    })

    expect(result.invitationEmail).toBe('bob@example.com')
    expect(result.hasUnsettledBalance).toBe(true)
  })

  it('reports hasUnsettledBalance=false when the invitee is fully settled', async () => {
    await authAs('acct-admin')
    seedRevokeContext({ participantId: 'lp-invitee' })
    // Each pays for themselves — settled.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 50,
        paidById: 'lp-invitee',
        paidFor: [{ participantId: 'lp-invitee', shares: 1 }],
      }),
      makeExpenseRow({
        id: 'exp-2',
        amount: 50,
        paidById: 'lp-caller',
        paidFor: [{ participantId: 'lp-caller', shares: 1 }],
      }),
    ] as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.revokePreview({
      groupId: 'grp-1',
      invitationId: 'inv-1',
    })

    expect(result.hasUnsettledBalance).toBe(false)
  })

  it('rejects a non-admin caller with FORBIDDEN', async () => {
    await authAs('acct-member')
    seedRevokeContext({ callerRole: 'MEMBER' })

    const caller = makeCaller('acct-member')
    await expect(
      caller.revokePreview({ groupId: 'grp-1', invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects an invitation that does not belong to the group with NOT_FOUND', async () => {
    await authAs('acct-admin')
    seedRevokeContext({ participantId: 'lp-invitee' })
    // Override the invite lookup so the helper sees a mismatched groupId.
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-OTHER',
      email: 'bob@example.com',
      role: 'MEMBER',
      status: 'PENDING',
      ledgerParticipantId: 'lp-invitee',
    } as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.revokePreview({ groupId: 'grp-1', invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('invitationsRouter.revoke — happy path', () => {
  it('revokes a pending invitation with no unsettled balances', async () => {
    await authAs('acct-admin')
    seedRevokeContext({ participantId: null })

    const caller = makeCaller('acct-admin')
    const result = await caller.revoke({ invitationId: 'inv-1' })

    expect(result).toEqual({})
    expect(prismaMock.groupInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ status: 'REVOKED' }),
      }),
    )
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
    expect(prisma$Transaction).toHaveBeenCalledTimes(1)
  })

  it('removes a revoked invitee from its subgroup in the same transaction', async () => {
    await authAs('acct-admin')
    seedRevokeContext({ participantId: 'lp-invitee' })
    prismaMock.subgroupMember.findUnique.mockResolvedValue({
      subgroupId: 'sg-invitee',
    } as never)
    prismaMock.subgroupMember.count.mockResolvedValue(1 as never)

    const caller = makeCaller('acct-admin')
    await caller.revoke({ invitationId: 'inv-1', settleBalances: false })

    expect(prismaMock.subgroupMember.delete).toHaveBeenCalledWith({
      where: {
        subgroupId_ledgerParticipantId: {
          subgroupId: 'sg-invitee',
          ledgerParticipantId: 'lp-invitee',
        },
      },
    })
    expect(prismaMock.subgroup.delete).toHaveBeenCalledWith({
      where: { id: 'sg-invitee' },
    })
  })
})

describe('invitationsRouter.revoke — unsettled balances', () => {
  it('rejects PRECONDITION_FAILED when the invitee has unsettled balances and no decision is supplied', async () => {
    await authAs('acct-admin')
    seedRevokeContext({ participantId: 'lp-invitee' })
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-invitee',
        paidFor: [
          { participantId: 'lp-invitee', shares: 1 },
          { participantId: 'lp-caller', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.revoke({ invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(prismaMock.groupInvitation.update).not.toHaveBeenCalled()
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
  })

  it('creates settlement expenses for the invitee before revoking when settleBalances=true', async () => {
    await authAs('acct-admin')
    seedRevokeContext({ participantId: 'lp-invitee' })
    // Invitee paid 100 for both: invitee +50, caller -50. Only one leg
    // involves the invitee, so exactly one settlement expense is written.
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-invitee',
        paidFor: [
          { participantId: 'lp-invitee', shares: 1 },
          { participantId: 'lp-caller', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      const data = (args as { data: { id: string } }).data
      return { id: data.id, ...(args as object) } as never
    })

    const caller = makeCaller('acct-admin')
    await caller.revoke({ invitationId: 'inv-1', settleBalances: true })

    expect(prismaMock.expense.create).toHaveBeenCalledTimes(1)
    const createCall = prismaMock.expense.create.mock.calls[0][0] as {
      data: {
        title: string
        amount: number
        paidByList: {
          createMany: {
            data: Array<{ ledgerParticipantId: string; shares: number }>
          }
        }
      }
    }
    expect(createCall.data.title).toBe('Settlement on leave')
    expect(createCall.data.paidByList.createMany.data).toEqual([
      { ledgerParticipantId: 'lp-caller', shares: 50 },
    ])
    expect(createCall.data.amount).toBe(50)
    expect(prismaMock.groupInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ status: 'REVOKED' }),
      }),
    )
  })

  it('revokes without settling when settleBalances=false and soft-hides the participant', async () => {
    await authAs('acct-admin')
    seedRevokeContext({ participantId: 'lp-invitee' })
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-invitee',
        paidFor: [
          { participantId: 'lp-invitee', shares: 1 },
          { participantId: 'lp-caller', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({} as never)
    prismaMock.activity.create.mockResolvedValue({
      id: 'act-1',
      time: new Date(),
    } as never)

    const caller = makeCaller('acct-admin')
    await caller.revoke({ invitationId: 'inv-1', settleBalances: false })

    expect(prismaMock.expense.create).not.toHaveBeenCalled()
    expect(prismaMock.groupInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ status: 'REVOKED' }),
      }),
    )
    expect(prismaMock.ledgerParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lp-invitee' },
        data: expect.objectContaining({ removedAt: expect.any(Date) }),
      }),
    )
  })
})

describe('invitationsRouter.revoke — guards', () => {
  it('rejects a resolved invitation', async () => {
    await authAs('acct-member')
    seedRevokeContext({
      callerRole: 'MEMBER',
      invitationStatus: 'ACCEPTED',
      invitedById: 'acct-member',
    })

    const caller = makeCaller('acct-member')
    await expect(
      caller.revoke({ invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.groupInvitation.update).not.toHaveBeenCalled()
  })

  it('rejects a MEMBER who did not create the invitation', async () => {
    await authAs('acct-member')
    seedRevokeContext({ callerRole: 'MEMBER' })

    const caller = makeCaller('acct-member')
    await expect(
      caller.revoke({ invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.groupInvitation.update).not.toHaveBeenCalled()
  })

  it('rejects an unknown invitation with NOT_FOUND', async () => {
    await authAs('acct-admin')
    seedRevokeContext({ participantId: null })
    prismaMock.groupInvitation.findUnique.mockResolvedValue(null as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.revoke({ invitationId: 'inv-unknown' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects an unauthenticated caller with UNAUTHORIZED', async () => {
    authState.session = null
    const ctx = await createTRPCContext({
      req: new Request('http://localhost/api/test'),
    })

    await expect(
      invitationsRouter
        .createCaller({
          auth: ctx.auth,
        } as never)
        .revoke({ invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('invitationsRouter.createLink', () => {
  it('creates a link invitation and returns a single-use URL for an ADMIN', async () => {
    await authAs('acct-admin')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.create.mockImplementation(
      async (args: unknown) => {
        const data = (
          args as { data: { type: string; tokenHash: string | null } }
        ).data
        return {
          id: 'inv-link-1',
          groupId: 'grp-1',
          role: data.type === 'LINK' ? 'MEMBER' : 'MEMBER',
          temporaryName: null,
          expiresAt: new Date('2030-01-01T00:00:00Z'),
          tokenHash: data.tokenHash,
        } as never
      },
    )

    const caller = makeCaller('acct-admin')
    const result = await caller.createLink({
      requestId: crypto.randomUUID(),
      groupId: 'grp-1',
      role: 'MEMBER',
    })

    expect(result.invitationId).toBe('inv-link-1')
    expect(result.inviteUrl).toMatch(
      /^http:\/\/localhost:3000\/groups\/grp-1\?invite=[A-Za-z0-9_-]+$/,
    )
    expect(prismaMock.groupInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          groupId: 'grp-1',
          type: 'LINK',
          invitedById: 'acct-admin',
          role: 'MEMBER',
          tokenHash: expect.any(String) as string,
        }),
      }),
    )
    // The raw token should never be stored. Only the hash goes in the
    // email column placeholder and the tokenHash column.
    const createArgs = prismaMock.groupInvitation.create.mock.calls[0]?.[0] as {
      data: { email: string; tokenHash: string }
    }
    expect(createArgs.data.email.endsWith('@link.placeholder.local')).toBe(true)
    expect(createArgs.data.email).not.toContain(result.inviteUrl)
  })

  it('lets a MEMBER create a MEMBER link invitation', async () => {
    await authAs('acct-member')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-member',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.create.mockResolvedValue({
      id: 'inv-link-member',
      groupId: 'grp-1',
      role: 'MEMBER',
      temporaryName: null,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      tokenHash: 'hash',
    } as never)

    const caller = makeCaller('acct-member')
    const result = await caller.createLink({
      groupId: 'grp-1',
      requestId: crypto.randomUUID(),
    })
    expect(result.invitationId).toBe('inv-link-member')
  })
})

describe('invitationsRouter.previewLink', () => {
  it('returns a usable preview for a pending link token', async () => {
    const token = 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2'
    prismaMock.groupInvitation.findFirst
      .calledWith(
        expect.objectContaining({
          where: { tokenHash: expect.any(String) as string },
        }) as never,
      )
      .mockResolvedValue({
        id: 'inv-link-1',
        status: 'PENDING',
        role: 'MEMBER',
        temporaryName: 'Alex',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        group: { id: 'grp-1', name: 'Trip' },
        invitedBy: { name: 'Alice' },
      } as never)

    const caller = invitationsRouter.createCaller({
      auth: null,
    } as never)
    const result = await caller.previewLink({ token })

    expect(result.preview).toMatchObject({
      group: { id: 'grp-1', name: 'Trip' },
      inviter: { name: 'Alice' },
      temporaryName: 'Alex',
      role: 'MEMBER',
      usable: true,
      reason: null,
    })
  })

  it('marks the preview as not usable for a revoked invitation', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-link-1',
      status: 'REVOKED',
      role: 'MEMBER',
      temporaryName: null,
      expiresAt: null,
      group: { id: 'grp-1', name: 'Trip' },
      invitedBy: { name: 'Alice' },
    } as never)

    const caller = invitationsRouter.createCaller({
      auth: null,
    } as never)
    const result = await caller.previewLink({
      token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2',
    })

    expect(result.preview?.usable).toBe(false)
    expect(result.preview?.reason).toBe('revoked')
  })

  it('marks the preview as not usable for an expired invitation', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-link-1',
      status: 'PENDING',
      role: 'MEMBER',
      temporaryName: null,
      expiresAt: new Date(Date.now() - 1000),
      group: { id: 'grp-1', name: 'Trip' },
      invitedBy: { name: 'Alice' },
    } as never)

    const caller = invitationsRouter.createCaller({
      auth: null,
    } as never)
    const result = await caller.previewLink({
      token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2',
    })

    expect(result.preview?.usable).toBe(false)
    expect(result.preview?.reason).toBe('expired')
  })

  it('returns null preview for an unknown token', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null as never)

    const caller = invitationsRouter.createCaller({
      auth: null,
    } as never)
    const result = await caller.previewLink({
      token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2',
    })

    expect(result.preview).toBeNull()
  })

  it('rejects an invalid token shape at the schema level', async () => {
    const caller = invitationsRouter.createCaller({
      auth: null,
    } as never)
    await expect(caller.previewLink({ token: 'shrt' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })
})

describe('invitationsRouter.acceptLink', () => {
  it('accepts a pending link token and creates a new group member', async () => {
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'bob@example.com',
      emailVerified: true,
      name: 'Bob',
    })

    // First call: pre-check via getLinkInvitationPreview (findFirst).
    // Second call: the pending-EMAIL-vs-link guard (findFirst).
    // Transaction re-reads the flipped row (findUnique by tokenHash).
    let findFirstCalls = 0
    prismaMock.groupInvitation.findFirst.mockImplementation(async (args) => {
      const where = (args as { where?: { type?: string } }).where
      findFirstCalls++
      if (where?.type === 'EMAIL') return null as never
      return {
        id: 'inv-link-1',
        status: 'PENDING',
        role: 'MEMBER',
        temporaryName: 'Alex',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        group: { id: 'grp-1', name: 'Trip' },
        invitedBy: { name: 'Alice' },
      } as never
    })
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-link-1',
      groupId: 'grp-1',
      role: 'MEMBER',
      status: 'PENDING',
      ledgerParticipantId: null,
      group: { id: 'grp-1', ledger: { id: 'ledger-1' } },
    } as never)
    prismaMock.groupMember.findFirst.mockResolvedValue(null as never)
    prismaMock.groupInvitation.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.groupMember.upsert.mockResolvedValue({
      id: 'gm-bob',
      groupId: 'grp-1',
      accountId: 'acct-bob',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.upsert.mockResolvedValue({} as never)

    const txMock = prisma$Transaction
    txMock.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (tx: unknown) => unknown)(prismaMock)
      }
      return undefined
    })

    const caller = invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-bob' },
        user: {
          id: 'acct-bob',
          email: 'bob@example.com',
          emailVerified: true,
          name: 'Bob',
        },
      },
    } as never)
    const result = await caller.acceptLink({
      token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2',
    })

    expect(result.groupId).toBe('grp-1')
    expect(result.role).toBe('MEMBER')
    expect(prismaMock.groupInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
        }),
      }),
    )
    // findFirst is hit twice before the transaction: once for the
    // pre-check (preview), once for the pending-EMAIL-vs-link guard.
    // The transaction re-reads the flipped row via findUnique.
    expect(findFirstCalls).toBe(2)
  })

  it('rejects an expired token via the pre-check', async () => {
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'bob@example.com',
      emailVerified: true,
      name: 'Bob',
    })
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-link-1',
      status: 'PENDING',
      role: 'MEMBER',
      temporaryName: null,
      expiresAt: new Date(Date.now() - 1000),
      group: { id: 'grp-1', name: 'Trip' },
      invitedBy: { name: 'Alice' },
    } as never)

    const caller = makeCaller('acct-bob')
    await expect(
      caller.acceptLink({ token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2' }),
    ).rejects.toThrow(/expired/i)
    expect(prismaMock.groupInvitation.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a revoked token via the pre-check', async () => {
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'bob@example.com',
      emailVerified: true,
      name: 'Bob',
    })
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-link-1',
      status: 'REVOKED',
      role: 'MEMBER',
      temporaryName: null,
      expiresAt: null,
      group: { id: 'grp-1', name: 'Trip' },
      invitedBy: { name: 'Alice' },
    } as never)

    const caller = makeCaller('acct-bob')
    await expect(
      caller.acceptLink({ token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2' }),
    ).rejects.toThrow(/revoked/i)
  })

  it('rejects an already-accepted token via the pre-check', async () => {
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'bob@example.com',
      emailVerified: true,
      name: 'Bob',
    })
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-link-1',
      status: 'ACCEPTED',
      role: 'MEMBER',
      temporaryName: null,
      expiresAt: null,
      group: { id: 'grp-1', name: 'Trip' },
      invitedBy: { name: 'Alice' },
    } as never)

    const caller = makeCaller('acct-bob')
    await expect(
      caller.acceptLink({ token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2' }),
    ).rejects.toThrow(/already been used/i)
  })

  it('rejects acceptance when the account is already an active member', async () => {
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'bob@example.com',
      emailVerified: true,
      name: 'Bob',
    })
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-link-1',
      status: 'PENDING',
      role: 'MEMBER',
      temporaryName: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      group: { id: 'grp-1', name: 'Trip' },
      invitedBy: { name: 'Alice' },
    } as never)
    prismaMock.groupMember.findFirst.mockResolvedValue({
      id: 'gm-bob',
    } as never)

    const caller = makeCaller('acct-bob')
    await expect(
      caller.acceptLink({ token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2' }),
    ).rejects.toThrow(/already a member/i)
  })

  it('rejects a link acceptance when the account has a pending EMAIL invitation for the group', async () => {
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'bob@example.com',
      emailVerified: true,
      name: 'Bob',
    })
    // The preview lookup returns the LINK row; the pending-EMAIL guard
    // (findFirst with `type: 'EMAIL'`) returns the personal invite.
    prismaMock.groupInvitation.findFirst.mockImplementation(
      async (args: unknown) => {
        const where = (args as { where?: { type?: string } }).where
        if (where?.type === 'EMAIL') {
          return { id: 'inv-email-1' } as never
        }
        return {
          id: 'inv-link-1',
          status: 'PENDING',
          role: 'MEMBER',
          temporaryName: null,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
          group: { id: 'grp-1', name: 'Trip' },
          invitedBy: { name: 'Alice' },
        } as never
      },
    )

    const caller = makeCaller('acct-bob')
    await expect(
      caller.acceptLink({ token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2' }),
    ).rejects.toThrow(/personal email invitation/i)
    // The link must not be flipped by the guard.
    expect(prismaMock.groupInvitation.updateMany).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller with UNAUTHORIZED', async () => {
    authState.session = null
    const ctx = await createTRPCContext({
      req: new Request('http://localhost/api/test'),
    })

    await expect(
      invitationsRouter
        .createCaller({
          auth: ctx.auth,
        } as never)
        .acceptLink({ token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('re-invites a previously-removed member without unique-constraint failure', async () => {
    // Scenario: the user was previously a member, the admin removed
    // them, the admin generated a new link, the user accepted. The
    // prior `LedgerParticipant` still has `groupMemberId=gm-a`; the
    // new pending placeholder would otherwise try to claim the same
    // link and crash the transaction.
    authState.session = {
      user: { id: 'acct-bob' },
      session: { id: 'sess-bob' },
    }
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-bob',
      email: 'bob@example.com',
      emailVerified: true,
      name: 'Bob',
    })

    prismaMock.groupInvitation.findFirst.mockImplementation(async (args) => {
      const where = (args as { where?: { type?: string } }).where
      if (where?.type === 'EMAIL') return null as never
      return {
        id: 'inv-link-2',
        status: 'PENDING',
        role: 'MEMBER',
        temporaryName: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        group: { id: 'grp-1', name: 'Trip' },
        invitedBy: { name: 'Alice' },
      } as never
    })
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-link-2',
      groupId: 'grp-1',
      role: 'MEMBER',
      status: 'PENDING',
      ledgerParticipantId: 'lp-new',
      group: { id: 'grp-1', ledger: { id: 'ledger-1' } },
    } as never)
    prismaMock.groupMember.findFirst.mockResolvedValue(null as never)
    prismaMock.groupMember.upsert.mockResolvedValue({
      // upsert reactives the existing member (status=REMOVED → ACTIVE).
      id: 'gm-bob',
      groupId: 'grp-1',
      accountId: 'acct-bob',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.groupInvitation.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    // The member already has a participant from the prior membership.
    prismaMock.ledgerParticipant.findUnique
      .mockImplementationOnce(async (args: unknown) => {
        const where = (args as { where: { groupMemberId?: string } }).where
        if (where.groupMemberId === 'gm-bob') {
          return {
            id: 'lp-old',
            groupMemberId: 'gm-bob',
            ledgerId: 'ledger-1',
          } as never
        }
        return null as never
      })
      // Subsequent lookups (if any) are no-ops.
      .mockResolvedValue(null as never)
    prismaMock.expense.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.expensePaidFor.updateMany.mockResolvedValue({
      count: 0,
    } as never)
    prismaMock.ledgerParticipant.delete.mockResolvedValue({} as never)

    const txMock = prisma$Transaction
    txMock.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (tx: unknown) => unknown)(prismaMock)
      }
      return undefined
    })

    const caller = invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-bob' },
        user: {
          id: 'acct-bob',
          email: 'bob@example.com',
          emailVerified: true,
          name: 'Bob',
        },
      },
    } as never)
    const result = await caller.acceptLink({
      token: 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2',
    })

    expect(result.groupId).toBe('grp-1')
    // The pending placeholder must be deleted in favor of the existing
    // participant (it would otherwise violate the unique constraint).
    expect(prismaMock.ledgerParticipant.delete).toHaveBeenCalledWith({
      where: { id: 'lp-new' },
    })
    // And the pending placeholder must NOT be updated in place.
    expect(prismaMock.ledgerParticipant.update).not.toHaveBeenCalled()
  })
})

describe('invitationsRouter.updatePending', () => {
  const NOW = new Date()

  function seedUpdateContext(args: {
    callerRole?: 'ADMIN' | 'MEMBER'
    invitation?: Partial<{
      type: 'EMAIL' | 'LINK'
      email: string
      temporaryName: string | null
      role: 'ADMIN' | 'MEMBER'
      status: 'PENDING' | 'ACCEPTED' | 'REVOKED'
      invitedById: string
      ledgerParticipantId: string | null
      tokenHash: string | null
      expiresAt: Date | null
    }>
    group?: Partial<{ archived: boolean; groupType: 'GROUP' | 'FRIEND' }>
  }) {
    const invitation = {
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'EMAIL',
      email: 'bob@example.com',
      temporaryName: null,
      role: 'MEMBER',
      status: 'PENDING',
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: null,
      ledgerParticipantId: 'lp-bob',
      invitedById: 'acct-admin',
      tokenHash: null,
      group: {
        archived: args.group?.archived ?? false,
        groupType: args.group?.groupType ?? 'GROUP',
      },
      ...args.invitation,
    }
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Roadtrip 2026',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currencyCode: null },
      archived: invitation.group.archived,
      groupType: invitation.group.groupType,
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-caller',
      role: args.callerRole ?? 'ADMIN',
      status: 'ACTIVE',
      ledgerParticipant: null,
    } as never)
    prismaMock.groupInvitation.findUnique.mockResolvedValue(invitation as never)
    prismaMock.groupInvitation.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({} as never)
    prismaMock.groupInvitation.findUniqueOrThrow.mockResolvedValue({
      ...invitation,
      updatedAt: new Date(NOW.getTime() + 1000),
    } as never)
    prismaMock.activity.create.mockResolvedValue({
      id: 'act-1',
      time: new Date(),
    } as never)
    return { invitation }
  }

  it('saves metadata-only changes (name/role) without resending or rotating', async () => {
    await authAs('acct-admin')
    seedUpdateContext({})

    const caller = makeCaller('acct-admin')
    const result = await caller.updatePending({
      invitationId: 'inv-1',
      role: 'ADMIN',
      temporaryName: 'Bobby',
      delivery: { type: 'EMAIL', email: 'bob@example.com' },
    })

    expect(result.inviteUrl).toBeNull()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(prismaMock.groupInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
        data: expect.objectContaining({
          role: 'ADMIN',
          temporaryName: 'Bobby',
        }),
      }),
    )
    // Participant display name mirrors the invitation label.
    expect(prismaMock.ledgerParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lp-bob' },
        data: { displayName: 'Bobby' },
      }),
    )
    // One INVITATION_UPDATED activity with display-safe changes.
    const activityCall = prismaMock.activity.create.mock.calls[0]?.[0] as {
      data: { type: string; data: { changes: unknown[] } }
    }
    expect(activityCall.data.type).toBe('INVITATION_UPDATED')
    expect(activityCall.data.data.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'displayName' }),
        expect.objectContaining({ field: 'role' }),
      ]),
    )
    // No raw token material in the activity payload.
    expect(JSON.stringify(activityCall.data.data)).not.toMatch(/placeholder/)
    // The mutation output mirrors the list's canRevoke computation.
    expect(result.invitation.canRevoke).toBe(true)
  })

  it('retargets the email, sends to the new recipient, and keeps the row/participant', async () => {
    await authAs('acct-admin')
    const { invitation } = seedUpdateContext({})
    // The transaction re-read reflects the retargeted row.
    prismaMock.groupInvitation.findUniqueOrThrow.mockResolvedValue({
      ...invitation,
      email: 'carol@example.com',
      updatedAt: new Date(NOW.getTime() + 1000),
    } as never)
    // No account exists for the new destination.
    prismaMock.account.findFirst.mockResolvedValue(null as never)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null as never)
    prismaMock.groupMember.findFirst.mockResolvedValue(null as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.updatePending({
      invitationId: 'inv-1',
      role: 'MEMBER',
      delivery: { type: 'EMAIL', email: 'CAROL@example.com' },
    })

    expect(result.inviteUrl).toBeNull()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock.mock.calls[0]?.[0]?.to).toBe('carol@example.com')
    expect(prismaMock.groupInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'carol@example.com',
          // tokenHash is untouched for EMAIL -> EMAIL.
          role: 'MEMBER',
        }),
      }),
    )
    const activityCall = prismaMock.activity.create.mock.calls[0]?.[0] as {
      data: { data: { changes: { field: string }[] } }
    }
    expect(activityCall.data.data.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'destination',
          before: 'bob@example.com',
          after: 'carol@example.com',
        }),
      ]),
    )
  })

  it('emails an existing account on retarget using the existing-user template', async () => {
    await authAs('acct-admin')
    const { invitation } = seedUpdateContext({})
    // The transaction re-read reflects the retargeted row.
    prismaMock.groupInvitation.findUniqueOrThrow.mockResolvedValue({
      ...invitation,
      email: 'carol@example.com',
      updatedAt: new Date(NOW.getTime() + 1000),
    } as never)
    prismaMock.account.findFirst.mockResolvedValue({
      id: 'acct-carol',
      name: 'Carol Profile',
      image: null,
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.updatePending({
      invitationId: 'inv-1',
      role: 'MEMBER',
      temporaryName: 'Submitted Name',
      delivery: { type: 'EMAIL', email: 'carol@example.com' },
    })

    // The retargeted existing account IS emailed (unlike the create path,
    // where the in-app notification covers it) — with the existing-user
    // template, which never renders a "you will appear as" line or puts the
    // temporary name in the subject.
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0][0]
    expect(call.to).toBe('carol@example.com')
    expect(call.text).toMatch(/open spliit cloud/i)
    expect(call.text).not.toContain('You will appear as')
    expect(call.text).not.toContain('Submitted Name')
    expect(call.subject).not.toContain('as Submitted Name')
    // Profile name is authoritative and overwrites the submitted name.
    expect(prismaMock.groupInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ temporaryName: 'Carol Profile' }),
      }),
    )
    expect(result.invitation.recipientProfile).toEqual({
      id: 'acct-carol',
      name: 'Carol Profile',
      image: null,
    })
    // The mutation output mirrors the list's canRevoke computation.
    expect(result.invitation.canRevoke).toBe(true)
  })

  it('converts EMAIL -> LINK, returns a one-time URL, and stores only the hash', async () => {
    await authAs('acct-admin')
    const { invitation } = seedUpdateContext({})
    // The transaction re-read reflects the converted row.
    prismaMock.groupInvitation.findUniqueOrThrow.mockResolvedValue({
      ...invitation,
      type: 'LINK',
      email: 'aGVsbG8@link.placeholder.local',
      tokenHash: 'new-hash',
      expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(NOW.getTime() + 1000),
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.updatePending({
      invitationId: 'inv-1',
      role: 'MEMBER',
      delivery: { type: 'LINK' },
    })

    expect(result.inviteUrl).toMatch(
      /^http:\/\/localhost:3000\/groups\/grp-1\?invite=[A-Za-z0-9_-]+$/,
    )
    expect(result.invitation.type).toBe('LINK')
    const updateArgs = prismaMock.groupInvitation.updateMany.mock
      .calls[0]?.[0] as {
      data: { type: string; email: string; tokenHash: string; expiresAt: Date }
    }
    expect(updateArgs.data.type).toBe('LINK')
    expect(updateArgs.data.email.endsWith('@link.placeholder.local')).toBe(true)
    expect(updateArgs.data.tokenHash).not.toBeNull()
    expect(prismaMock.activity.create).toHaveBeenCalled()
  })

  it('converts LINK -> EMAIL and clears the credential', async () => {
    await authAs('acct-admin')
    seedUpdateContext({
      invitation: {
        type: 'LINK',
        email: 'aGVsbG8@link.placeholder.local',
        tokenHash: 'old-hash',
        expiresAt: NOW,
      },
    })
    prismaMock.account.findFirst.mockResolvedValue(null as never)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null as never)
    prismaMock.groupMember.findFirst.mockResolvedValue(null as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.updatePending({
      invitationId: 'inv-1',
      role: 'MEMBER',
      delivery: { type: 'EMAIL', email: 'carol@example.com' },
    })

    expect(result.inviteUrl).toBeNull()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.groupInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'EMAIL',
          email: 'carol@example.com',
          tokenHash: null,
          expiresAt: null,
        }),
      }),
    )
  })

  it('updates an expired PENDING link invitation (metadata only)', async () => {
    await authAs('acct-admin')
    seedUpdateContext({
      invitation: {
        type: 'LINK',
        email: 'aGVsbG8@link.placeholder.local',
        tokenHash: 'old-hash',
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const result = await makeCaller('acct-admin').updatePending({
      invitationId: 'inv-1',
      role: 'ADMIN',
      temporaryName: 'Renamed Guest',
      delivery: { type: 'LINK' },
    })

    expect(result.inviteUrl).toBeNull()
    expect(result.invitation).toMatchObject({
      type: 'LINK',
      status: 'PENDING',
      canManage: true,
      canRevoke: true,
    })
    expect(prismaMock.groupInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
      }),
    )
  })

  it('rejects a member managing an invitation they did not create', async () => {
    await authAs('acct-member')
    seedUpdateContext({ callerRole: 'MEMBER' })

    await expect(
      makeCaller('acct-member').updatePending({
        invitationId: 'inv-1',
        role: 'MEMBER',
        delivery: { type: 'LINK' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.groupInvitation.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a member assigning the ADMIN role', async () => {
    await authAs('acct-member')
    seedUpdateContext({
      callerRole: 'MEMBER',
      invitation: { invitedById: 'acct-member' },
    })

    await expect(
      makeCaller('acct-member').updatePending({
        invitationId: 'inv-1',
        role: 'ADMIN',
        delivery: { type: 'LINK' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects managing a non-pending invitation', async () => {
    await authAs('acct-admin')
    seedUpdateContext({ invitation: { status: 'ACCEPTED' } })

    await expect(
      makeCaller('acct-admin').updatePending({
        invitationId: 'inv-1',
        role: 'MEMBER',
        delivery: { type: 'LINK' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects updates in archived groups', async () => {
    await authAs('acct-admin')
    seedUpdateContext({ group: { archived: true } })

    await expect(
      makeCaller('acct-admin').updatePending({
        invitationId: 'inv-1',
        role: 'MEMBER',
        delivery: { type: 'LINK' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects updates in FRIEND groups', async () => {
    await authAs('acct-admin')
    seedUpdateContext({ group: { groupType: 'FRIEND' } })

    await expect(
      makeCaller('acct-admin').updatePending({
        invitationId: 'inv-1',
        role: 'MEMBER',
        delivery: { type: 'LINK' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects a duplicate pending destination email', async () => {
    await authAs('acct-admin')
    seedUpdateContext({})
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-other',
    } as never)

    await expect(
      makeCaller('acct-admin').updatePending({
        invitationId: 'inv-1',
        role: 'MEMBER',
        delivery: { type: 'EMAIL', email: 'carol@example.com' },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/already pending/i),
    })
  })

  it('rejects retargeting to the inviter’s own email', async () => {
    await authAs('acct-admin')
    seedUpdateContext({})

    // authAs binds the caller account to alice@example.com.
    await expect(
      makeCaller('acct-admin').updatePending({
        invitationId: 'inv-1',
        role: 'MEMBER',
        delivery: { type: 'EMAIL', email: 'ALICE@example.com' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects a concurrent stale update once the invitation is no longer pending', async () => {
    await authAs('acct-admin')
    seedUpdateContext({})
    prismaMock.groupInvitation.updateMany.mockResolvedValue({
      count: 0,
    } as never)

    await expect(
      makeCaller('acct-admin').updatePending({
        invitationId: 'inv-1',
        role: 'MEMBER',
        delivery: { type: 'LINK' },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/no longer pending/i),
    })
  })

  it('does not leak the tokenHash in the mutation response', async () => {
    await authAs('acct-admin')
    seedUpdateContext({})

    const result = await makeCaller('acct-admin').updatePending({
      invitationId: 'inv-1',
      role: 'MEMBER',
      delivery: { type: 'LINK' },
    })
    expect(JSON.stringify(result)).not.toContain('tokenHash')
  })
})

describe('invitationsRouter.regenerateLink', () => {
  const NOW = new Date()

  function seedRegenerateContext(args: {
    callerRole?: 'ADMIN' | 'MEMBER'
    invitation?: Partial<{
      email: string
      temporaryName: string | null
      role: 'ADMIN' | 'MEMBER'
      status: 'PENDING' | 'ACCEPTED'
      invitedById: string
      tokenHash: string | null
      expiresAt: Date | null
    }>
  }) {
    const invitation = {
      id: 'inv-1',
      groupId: 'grp-1',
      type: 'LINK',
      email: 'aGVsbG8@link.placeholder.local',
      temporaryName: 'Guest',
      role: 'MEMBER',
      status: 'PENDING',
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: NOW,
      ledgerParticipantId: 'lp-bob',
      invitedById: 'acct-admin',
      tokenHash: 'old-hash',
      group: { archived: false, groupType: 'GROUP' },
      ...args.invitation,
    }
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Roadtrip 2026',
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currencyCode: null },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      accountId: 'acct-caller',
      role: args.callerRole ?? 'ADMIN',
      status: 'ACTIVE',
      ledgerParticipant: null,
    } as never)
    prismaMock.groupInvitation.findUnique.mockResolvedValue(invitation as never)
    prismaMock.groupInvitation.updateMany.mockResolvedValue({
      count: 1,
    } as never)
    prismaMock.groupInvitation.findUniqueOrThrow.mockResolvedValue({
      ...invitation,
      tokenHash: 'new-hash',
      expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(NOW.getTime() + 1000),
    } as never)
    prismaMock.activity.create.mockResolvedValue({
      id: 'act-1',
      time: new Date(),
    } as never)
  }

  it('rotates the credential, returns the new URL, and resets expiry', async () => {
    await authAs('acct-admin')
    seedRegenerateContext({})

    const caller = makeCaller('acct-admin')
    const result = await caller.regenerateLink({ invitationId: 'inv-1' })

    expect(result.inviteUrl).toMatch(
      /^http:\/\/localhost:3000\/groups\/grp-1\?invite=[A-Za-z0-9_-]+$/,
    )
    expect(prismaMock.groupInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
        data: expect.objectContaining({
          tokenHash: expect.not.stringMatching(/^old-hash$/) as string,
          expiresAt: expect.any(Date) as Date,
        }),
      }),
    )
    // Credential rotation is recorded, never the raw token.
    const activityCall = prismaMock.activity.create.mock.calls[0]?.[0] as {
      data: { type: string; data: { changes: unknown[] } }
    }
    expect(activityCall.data.type).toBe('INVITATION_UPDATED')
    expect(JSON.stringify(activityCall.data.data)).toContain('credential')
    expect(JSON.stringify(activityCall.data.data)).not.toContain('placeholder')
    // The mutation output mirrors the list's canRevoke computation.
    expect(result.invitation.canRevoke).toBe(true)
  })

  it('regenerates an expired link invitation (recovery path)', async () => {
    await authAs('acct-admin')
    seedRegenerateContext({
      invitation: { expiresAt: new Date(Date.now() - 1000) },
    })

    const result = await makeCaller('acct-admin').regenerateLink({
      invitationId: 'inv-1',
    })

    expect(result.inviteUrl).toMatch(
      /^http:\/\/localhost:3000\/groups\/grp-1\?invite=/,
    )
    expect(result.invitation).toMatchObject({
      status: 'PENDING',
      canManage: true,
      canRevoke: true,
    })
    expect(result.invitation.expiresAt).not.toBeNull()
  })

  it('rejects regeneration of an email invitation', async () => {
    await authAs('acct-admin')
    seedRegenerateContext({ invitation: { type: 'EMAIL', tokenHash: null } })

    await expect(
      makeCaller('acct-admin').regenerateLink({ invitationId: 'inv-1' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/link/i),
    })
  })

  it('rejects a member regenerating an invitation they did not create', async () => {
    await authAs('acct-member')
    seedRegenerateContext({ callerRole: 'MEMBER' })

    await expect(
      makeCaller('acct-member').regenerateLink({ invitationId: 'inv-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
