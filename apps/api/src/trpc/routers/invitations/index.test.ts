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
 * Build the prisma stubs the revoke procedure needs:
 *   - resolve the group context for the caller (`loadGroupContext`),
 *   - resolve the invitation by id (the pre-check + transaction both query it),
 *   - empty recurring-expense + expense stubs so `getGroupBalances` doesn't
 *     hit the `null is not iterable` path used by other helper flows.
 *
 * `invitationStatus` defaults to PENDING so the normal happy path doesn't
 * have to opt in. `participantId` controls whether the invitation has a
 * materialized ledger participant (real invitees always do once the
 * invitee appears as paid-by / paid-for on an expense).
 */
function seedRevokeContext(args: {
  callerRole?: 'ADMIN' | 'MEMBER'
  invitationStatus?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'DECLINED'
  participantId?: string | null
  invitationId?: string
  groupId?: string
  ledgerId?: string
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
  } as never)
  prismaMock.groupInvitation.update.mockResolvedValue({
    id: invitationId,
    status: 'REVOKED',
    revokedAt: new Date(),
  } as never)
  prismaMock.recurringExpenseLink.findMany.mockResolvedValue([] as never)
  prismaMock.expense.findMany.mockResolvedValue([] as never)
  return { groupId, ledgerId, invitationId, participantId }
}

/**
 * Build a single "expense" record as `getGroupExpenses` would return it
 * after the row is materialised by Prisma. Mirrors the shape used in
 * `members/index.test.ts` so the balance pipeline runs end-to-end on
 * the mock prisma client.
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
    paidBySplitMode: 'BY_AMOUNT',
    paidByList: [
      {
        shares: args.amount,
        ledgerParticipant: {
          id: args.paidById,
          groupMember: { account: { name: args.paidById } },
          invitations: [],
        },
      },
    ],
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

  it('rejects settleBalances=false when the invitee has unsettled balances', async () => {
    // Leaving the balances in place after a revoke would leave the
    // invitee's participant orphaned in the ledger (no groupMember, no
    // PENDING invitation) and break the balances view. The admin must
    // settle first, mirroring the archive flow.
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
      caller.revoke({ invitationId: 'inv-1', settleBalances: false }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(prismaMock.expense.create).not.toHaveBeenCalled()
    expect(prismaMock.groupInvitation.update).not.toHaveBeenCalled()
  })
})

describe('invitationsRouter.revoke — guards', () => {
  it('rejects a MEMBER with FORBIDDEN', async () => {
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
    await expect(caller.createLink({ groupId: 'grp-1' })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    )
    expect(prismaMock.groupInvitation.create).not.toHaveBeenCalled()
  })
})

describe('invitationsRouter.previewLink', () => {
  it('returns a usable preview for a pending link token', async () => {
    const token = 'aGVsbG8td29ybGQtdG9rZW4tMTIzNDU2'
    prismaMock.groupInvitation.findFirst.mockImplementation(
      async (args: unknown) => {
        const where = (args as { where: { tokenHash: string } }).where
        // The helper hashes the token before querying. We don't pin the
        // exact hash here — just verify the call ran with a non-empty
        // hash.
        expect(where.tokenHash).toBeTruthy()
        return {
          id: 'inv-link-1',
          status: 'PENDING',
          role: 'MEMBER',
          temporaryName: 'Alex',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
          group: { id: 'grp-1', name: 'Trip' },
          invitedBy: { name: 'Alice' },
        } as never
      },
    )

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
    // Second call: the transaction's re-read of the flipped row
    // (findUnique by tokenHash).
    let findFirstCalls = 0
    prismaMock.groupInvitation.findFirst.mockImplementation(async () => {
      findFirstCalls++
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
    // findFirst is hit twice: once for the pre-check, once (via
    // findUnique) inside the transaction when re-reading the flipped
    // row.
    expect(findFirstCalls).toBe(1)
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

    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-link-2',
      status: 'PENDING',
      role: 'MEMBER',
      temporaryName: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      group: { id: 'grp-1', name: 'Trip' },
      invitedBy: { name: 'Alice' },
    } as never)
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
