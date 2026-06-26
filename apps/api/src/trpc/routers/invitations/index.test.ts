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

  it('rejects a MEMBER with FORBIDDEN', async () => {
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

    const caller = makeCaller('acct-member')
    await expect(caller.list({ groupId: 'grp-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
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
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.create({
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

  it('rejects a MEMBER with FORBIDDEN', async () => {
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

    const caller = makeCaller('acct-member')
    await expect(
      caller.create({
        groupId: 'grp-1',
        email: 'bob@example.com',
        role: 'MEMBER',
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

  it('rejects an invitation when the same email has already been accepted', async () => {
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
    prismaMock.groupInvitation.findFirst.mockImplementation((async (
      args: unknown,
    ) => {
      const a = args as { where?: { status?: string } }
      if (a.where?.status === 'ACCEPTED') {
        return { id: 'inv-accepted' } as never
      }
      return null
    }) as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.create({
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

  it('sends an "in-app" invitation email when the recipient already has an account', async () => {
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
    } as never)

    const caller = makeCaller('acct-admin')
    await caller.create({
      groupId: 'grp-1',
      email: 'bob@example.com',
      role: 'MEMBER',
    })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0][0]
    expect(call.to).toBe('bob@example.com')
    expect(call.subject).toContain('Roadtrip 2026')
    expect(call.text).toMatch(/open spliit/i)
    // Email links to the group page itself (not /members): the
    // `groups.get` procedure now allows pending invitees to open
    // /groups/:id and surfaces an Accept/Decline banner in the header.
    expect(call.text).toContain('/groups/grp-1')
    expect(call.text).not.toMatch(/create an account/i)
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

  it('rejects a decline from an account whose email does not match', async () => {
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
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
