// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { describe, expect, it } from 'vitest'
import '../../../../test/mocks'
import { prismaMock } from '../../../../test/state'
import { importLinksRouter } from './index'

function makeCaller(authUserId: string, role: 'ADMIN' | 'MEMBER' = 'ADMIN') {
  return {
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'admin@example.com',
        emailVerified: true,
        name: 'Admin',
      },
    },
    member: {
      id: 'gm-admin',
      groupId: 'grp-1',
      accountId: authUserId,
      role,
      status: 'ACTIVE',
    },
  } as never
}

function stubGroupContext(memberRole: 'ADMIN' | 'MEMBER' = 'ADMIN') {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-1',
    name: 'Test',
    information: null,
    createdAt: new Date(),
    archived: false,
    ledgerId: 'ledger-1',
    ledger: { id: 'ledger-1', currency: '€', currencyCode: 'EUR' },
  } as never)
  prismaMock.groupMember.findUnique.mockImplementation(
    async (args: unknown) => {
      const where = (
        args as { where: { groupId_accountId: { accountId: string } } }
      ).where
      return {
        id: 'gm-' + where.groupId_accountId.accountId,
        groupId: 'grp-1',
        accountId: where.groupId_accountId.accountId,
        role: memberRole,
        status: 'ACTIVE',
        joinedAt: new Date(),
      } as never
    },
  )
  // Default: no pending invitations. Individual tests override when they
  // want to exercise the PENDING candidate branch.
  prismaMock.groupInvitation.findMany.mockResolvedValue([] as never)
}

describe('importLinksRouter.link — email-based lookup', () => {
  it('looks up the account by email and links it to the unlinked participant', async () => {
    stubGroupContext()
    // First call (loadGroupContext) returns the admin member; the
    // second call (linkUnlinkedParticipantToAccount's existing-member
    // lookup for the target account) returns null so the test
    // exercises the new-member branch.
    let groupMemberCalls = 0
    prismaMock.groupMember.findUnique.mockImplementation(
      async (args: unknown) => {
        groupMemberCalls += 1
        const where = (
          args as { where: { groupId_accountId: { accountId: string } } }
        ).where
        if (where.groupId_accountId.accountId === 'acct-admin') {
          return {
            id: 'gm-admin',
            groupId: 'grp-1',
            accountId: 'acct-admin',
            role: 'ADMIN',
            status: 'ACTIVE',
            joinedAt: new Date(),
          } as never
        }
        return null as never
      },
    )
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-1',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)
    prismaMock.account.findFirst.mockResolvedValue({
      id: 'acct-target',
    } as never)
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-target',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'gm-new',
      groupId: 'grp-1',
      accountId: 'acct-target',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({} as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.link({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-1',
      email: 'Jane@Example.com',
    })

    expect(result).toEqual({
      groupMemberId: 'gm-new',
      ledgerParticipantId: 'lp-1',
    })
    expect(groupMemberCalls).toBeGreaterThanOrEqual(2)
    // The lookup used the lowercased email.
    expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
      where: { email: 'jane@example.com' },
      select: { id: true },
    })
  })

  it('throws NOT_FOUND when no account exists for the email', async () => {
    stubGroupContext()
    prismaMock.account.findFirst.mockResolvedValue(null as never)
    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    await expect(
      caller.link({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-1',
        email: 'unknown@example.com',
      }),
    ).rejects.toThrow(/No account exists for unknown@example.com/)
  })

  it('rejects when neither accountId, email, nor pendingInvitationId is supplied', async () => {
    stubGroupContext()
    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    await expect(
      caller.link({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-1',
      }),
    ).rejects.toThrow(
      /Either accountId, email, or pendingInvitationId is required/i,
    )
  })

  it('rejects when the caller is not an admin of the group', async () => {
    stubGroupContext('MEMBER')
    const caller = importLinksRouter.createCaller(
      makeCaller('acct-member', 'MEMBER'),
    )
    await expect(
      caller.link({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-1',
        email: 'anyone@example.com',
      }),
    ).rejects.toThrow(/Only admins/i)
  })

  it('links the unlinked LP to an existing member whose email resolves to an account', async () => {
    // Regression for the "Ledger participant is not unlinked" bug:
    // the dialog passes the source unlinked LP id (not the destination
    // member's LP id) and the destination member's email. The mutation
    // must use `ledgerParticipantId` as the source id and resolve the
    // email to an account for the destination.
    stubGroupContext()
    let groupMemberCalls = 0
    prismaMock.groupMember.findUnique.mockImplementation(
      async (args: unknown) => {
        groupMemberCalls += 1
        const where = (
          args as { where: { groupId_accountId: { accountId: string } } }
        ).where
        if (where.groupId_accountId.accountId === 'acct-admin') {
          return {
            id: 'gm-admin',
            groupId: 'grp-1',
            accountId: 'acct-admin',
            role: 'ADMIN',
            status: 'ACTIVE',
            joinedAt: new Date(),
          } as never
        }
        if (where.groupId_accountId.accountId === 'acct-alice') {
          return {
            id: 'gm-alice',
            groupId: 'grp-1',
            accountId: 'acct-alice',
            role: 'MEMBER',
            status: 'ACTIVE',
            joinedAt: new Date(),
          } as never
        }
        return null as never
      },
    )
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-jane',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)
    prismaMock.account.findFirst.mockResolvedValue({
      id: 'acct-alice',
    } as never)
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-alice',
    } as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-alice',
      groupId: 'grp-1',
      accountId: 'acct-alice',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({} as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.link({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-jane',
      email: 'alice@example.com',
    })

    expect(result).toEqual({
      groupMemberId: 'gm-alice',
      ledgerParticipantId: 'lp-jane',
    })
    expect(groupMemberCalls).toBeGreaterThanOrEqual(2)
    expect(prismaMock.account.findFirst).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
      select: { id: true },
    })
  })

  it('merges the unlinked LP into a pending invitation and deletes the source', async () => {
    stubGroupContext()
    prismaMock.ledgerParticipant.findUnique.mockImplementation(
      async (args: unknown) => {
        const where = (args as { where: { id: string } }).where
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
        return null as never
      },
    )
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-carla',
      groupId: 'grp-1',
      type: 'EMAIL',
      status: 'PENDING',
      email: 'carla@example.com',
      ledgerParticipant: {
        id: 'lp-carla-pending',
        ledgerId: 'ledger-1',
        groupMemberId: null,
      },
    } as never)
    prismaMock.expensePaidFor.updateMany.mockResolvedValue({
      count: 2,
    } as never)
    prismaMock.expense.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.ledgerParticipant.delete.mockResolvedValue({} as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.link({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-jane',
      pendingInvitationId: 'inv-carla',
    })

    expect(result).toEqual({
      groupMemberId: null,
      ledgerParticipantId: 'lp-carla-pending',
    })
    expect(prismaMock.expensePaidFor.updateMany).toHaveBeenCalledWith({
      where: { ledgerParticipantId: 'lp-jane' },
      data: { ledgerParticipantId: 'lp-carla-pending' },
    })
    expect(prismaMock.expense.updateMany).toHaveBeenCalledWith({
      where: { paidById: 'lp-jane' },
      data: { paidById: 'lp-carla-pending' },
    })
    expect(prismaMock.ledgerParticipant.delete).toHaveBeenCalledWith({
      where: { id: 'lp-jane' },
    })
    // Email-based account resolution is skipped when pendingInvitationId
    // is supplied.
    expect(prismaMock.account.findFirst).not.toHaveBeenCalled()
  })

  it('rejects the link to a non-pending invitation', async () => {
    stubGroupContext()
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-jane',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-carla',
      groupId: 'grp-1',
      type: 'EMAIL',
      status: 'ACCEPTED',
      email: 'carla@example.com',
      ledgerParticipant: { id: 'lp-carla-pending', ledgerId: 'ledger-1' },
    } as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    await expect(
      caller.link({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-jane',
        pendingInvitationId: 'inv-carla',
      }),
    ).rejects.toThrow(/Invitation is not pending/)
  })

  it('merges the unlinked LP into a pending LINK-type invitation with a synthetic email', async () => {
    // Regression: the previous implementation rejected LINK-type
    // invitations outright. The link flow is keyed by
    // `pendingInvitationId` — the synthetic `*.placeholder.local`
    // email is never used for account resolution and is therefore
    // safe to carry through.
    stubGroupContext()
    prismaMock.ledgerParticipant.findUnique.mockImplementation(
      async (args: unknown) => {
        const where = (args as { where: { id: string } }).where
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
        return null as never
      },
    )
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-link-jane',
      groupId: 'grp-1',
      type: 'LINK',
      status: 'PENDING',
      email: 'tok-abc-123@link.placeholder.local',
      ledgerParticipant: {
        id: 'lp-link-jane-pending',
        ledgerId: 'ledger-1',
        groupMemberId: null,
      },
    } as never)
    prismaMock.expensePaidFor.updateMany.mockResolvedValue({
      count: 2,
    } as never)
    prismaMock.expense.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.ledgerParticipant.delete.mockResolvedValue({} as never)
    prismaMock.activity.create.mockResolvedValue({} as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.link({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-jane',
      pendingInvitationId: 'inv-link-jane',
    })

    expect(result).toEqual({
      groupMemberId: null,
      ledgerParticipantId: 'lp-link-jane-pending',
    })
    expect(prismaMock.expensePaidFor.updateMany).toHaveBeenCalledWith({
      where: { ledgerParticipantId: 'lp-jane' },
      data: { ledgerParticipantId: 'lp-link-jane-pending' },
    })
    expect(prismaMock.expense.updateMany).toHaveBeenCalledWith({
      where: { paidById: 'lp-jane' },
      data: { paidById: 'lp-link-jane-pending' },
    })
    expect(prismaMock.ledgerParticipant.delete).toHaveBeenCalledWith({
      where: { id: 'lp-jane' },
    })
    // Account lookup is bypassed when pendingInvitationId is supplied.
    expect(prismaMock.account.findFirst).not.toHaveBeenCalled()
  })
})

describe('importLinksRouter.candidates', () => {
  function stubUnlinkedParticipant(id = 'lp-unlinked') {
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id,
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)
  }

  it('returns MEMBER candidates when the unlinked LP has no expense conflict', async () => {
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-alice',
        groupMember: {
          account: { name: 'Alice', email: 'alice@example.com' },
        },
      },
      {
        id: 'lp-bob',
        groupMember: {
          account: { name: 'Bob', email: 'bob@example.com' },
        },
      },
    ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(result.candidates).toEqual([
      {
        id: 'lp-alice',
        name: 'Alice',
        email: 'alice@example.com',
        kind: 'MEMBER',
        invitationId: null,
      },
      {
        id: 'lp-bob',
        name: 'Bob',
        email: 'bob@example.com',
        kind: 'MEMBER',
        invitationId: null,
      },
    ])
  })

  it('excludes a MEMBER whose LP is on the opposite side of an expense leg', async () => {
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    // Jane paid; Bob (already a member) owes the share. Linking Jane to
    // Bob's LP would put the same person on both sides of the leg.
    prismaMock.expense.findMany.mockResolvedValue([
      {
        paidById: 'lp-unlinked',
        paidFor: [{ ledgerParticipantId: 'lp-bob' }],
      },
    ] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-alice',
        groupMember: {
          account: { name: 'Alice', email: 'alice@example.com' },
        },
      },
      {
        id: 'lp-bob',
        groupMember: {
          account: { name: 'Bob', email: 'bob@example.com' },
        },
      },
    ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(result.candidates).toEqual([
      {
        id: 'lp-alice',
        name: 'Alice',
        email: 'alice@example.com',
        kind: 'MEMBER',
        invitationId: null,
      },
    ])
  })

  it('excludes the unlinked LP itself', async () => {
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    // The query that backs the procedure already filters by kind +
    // ACTIVE member; the test mirrors the real shape by including the
    // unlinked LP in the result set anyway. The procedure must skip it
    // via its own `id !== unlinkedParticipantId` guard.
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-unlinked',
        groupMember: {
          account: { name: 'Jane', email: 'jane@example.com' },
        },
      },
      {
        id: 'lp-alice',
        groupMember: {
          account: { name: 'Alice', email: 'alice@example.com' },
        },
      },
    ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(result.candidates).toEqual([
      {
        id: 'lp-alice',
        name: 'Alice',
        email: 'alice@example.com',
        kind: 'MEMBER',
        invitationId: null,
      },
    ])
  })

  it('rejects with NOT_FOUND for a missing LP id', async () => {
    stubGroupContext()
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue(null as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    await expect(
      caller.candidates({ unlinkedParticipantId: 'lp-missing' }),
    ).rejects.toThrow(/Ledger participant not found/)
  })

  it('returns an empty list when every member is blocked', async () => {
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    // Single expense where Jane is the payer and is also on the
    // paidFor side of every other LP. Combined with the ACTIVE-member
    // candidate list returning just Bob, Bob ends up in the blocked
    // set.
    prismaMock.expense.findMany.mockResolvedValue([
      {
        paidById: 'lp-unlinked',
        paidFor: [{ ledgerParticipantId: 'lp-bob' }],
      },
    ] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-bob',
        groupMember: {
          account: { name: 'Bob', email: 'bob@example.com' },
        },
      },
    ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(result.candidates).toEqual([])
  })

  it('returns PENDING EMAIL-type candidates alongside MEMBER candidates', async () => {
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-alice',
        groupMember: {
          account: { name: 'Alice', email: 'alice@example.com' },
        },
      },
    ] as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-carla',
        type: 'EMAIL',
        email: 'carla@example.com',
        temporaryName: 'Carla',
        ledgerParticipant: { id: 'lp-carla-pending', ledgerId: 'ledger-1' },
      },
    ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(result.candidates).toEqual([
      {
        id: 'lp-alice',
        name: 'Alice',
        email: 'alice@example.com',
        kind: 'MEMBER',
        invitationId: null,
      },
      {
        id: 'lp-carla-pending',
        name: 'Carla',
        email: 'carla@example.com',
        kind: 'PENDING',
        invitationId: 'inv-carla',
      },
    ])
  })

  it('falls back to the invitation email when no temporaryName is set', async () => {
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-dan',
        type: 'EMAIL',
        email: 'dan@example.com',
        temporaryName: null,
        ledgerParticipant: { id: 'lp-dan-pending', ledgerId: 'ledger-1' },
      },
    ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(result.candidates).toEqual([
      {
        id: 'lp-dan-pending',
        name: 'dan@example.com',
        email: 'dan@example.com',
        kind: 'PENDING',
        invitationId: 'inv-dan',
      },
    ])
  })

  it('includes LINK-type invitations in the candidates list when their LP is materialized', async () => {
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-link-1',
        email: 'token@link.placeholder.local',
        temporaryName: null,
        ledgerParticipant: { id: 'lp-link-1', ledgerId: 'ledger-1' },
      },
    ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(result.candidates).toEqual([
      {
        id: 'lp-link-1',
        name: 'token@link.placeholder.local',
        email: 'token@link.placeholder.local',
        kind: 'PENDING',
        invitationId: 'inv-link-1',
      },
    ])
  })

  it('materializes pending invitation LPs and includes them in the candidates list', async () => {
    // Regression: the candidates procedure does not call `getGroup`,
    // so an EMAIL or LINK-type invitation created in the current
    // session has `ledgerParticipantId: null` until either `getGroup`
    // runs or the candidates modal itself materializes a row. The
    // modal must surface such invitations by materializing them in a
    // best-effort transaction before the picker query.
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    prismaMock.groupInvitation.update.mockResolvedValue({} as never)
    // First call: materialization pass returns the un-materialized
    // invitation. Subsequent calls (the candidates query) return
    // the now-materialized invitation.
    prismaMock.groupInvitation.findMany
      .mockResolvedValueOnce([{ id: 'inv-fresh' }] as never)
      .mockResolvedValue([
        {
          id: 'inv-fresh',
          email: 'fresh@example.com',
          temporaryName: 'Fresh',
          ledgerParticipant: { id: 'lp-fresh-pending', ledgerId: 'ledger-1' },
        },
      ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(prismaMock.ledgerParticipant.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        ledgerId: 'ledger-1',
        kind: 'UNLINKED_PARTICIPANT',
      },
    })
    expect(prismaMock.groupInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv-fresh' },
      data: { ledgerParticipantId: expect.any(String) },
    })
    expect(result.candidates).toEqual([
      {
        id: 'lp-fresh-pending',
        name: 'Fresh',
        email: 'fresh@example.com',
        kind: 'PENDING',
        invitationId: 'inv-fresh',
      },
    ])
  })

  it('excludes a PENDING candidate whose LP is on the opposite side of an expense leg', async () => {
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)
    // The pending invitee is on the paidFor side of an expense the
    // unlinked LP paid for. Linking would put the same person on both
    // sides of the leg.
    prismaMock.expense.findMany.mockResolvedValue([
      {
        paidById: 'lp-unlinked',
        paidFor: [{ ledgerParticipantId: 'lp-carla-pending' }],
      },
    ] as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-carla',
        type: 'EMAIL',
        email: 'carla@example.com',
        temporaryName: 'Carla',
        ledgerParticipant: { id: 'lp-carla-pending', ledgerId: 'ledger-1' },
      },
    ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(result.candidates).toEqual([])
  })

  it('excludes PENDING invitations whose LP landed in a different ledger', async () => {
    stubGroupContext()
    stubUnlinkedParticipant('lp-unlinked')
    prismaMock.expense.findMany.mockResolvedValue([] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-stale',
        type: 'EMAIL',
        email: 'stale@example.com',
        temporaryName: null,
        // Different ledger — defensive filter must skip it.
        ledgerParticipant: { id: 'lp-stale', ledgerId: 'ledger-other' },
      },
    ] as never)

    const caller = importLinksRouter.createCaller(makeCaller('acct-admin'))
    const result = await caller.candidates({
      unlinkedParticipantId: 'lp-unlinked',
    })

    expect(result.candidates).toEqual([])
  })
})
