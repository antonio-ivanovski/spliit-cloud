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

function seedGroupContext() {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-1',
    ledgerId: 'ledger-1',
    groupType: 'GROUP',
    archived: false,
    ledger: { id: 'ledger-1', currencyCode: 'USD' },
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue({
    id: 'gm-admin',
    groupId: 'grp-1',
    accountId: 'acct-admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    ledgerParticipant: null,
  } as never)
  prismaMock.expense.findMany.mockResolvedValue([] as never)
  prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)
  prismaMock.activity.create.mockResolvedValue({
    id: 'act-1',
    time: new Date(),
  } as never)
  prisma$Transaction.mockImplementation(async (input: unknown) => {
    if (typeof input === 'function') {
      return (input as (tx: unknown) => unknown)(prismaMock)
    }
    return undefined
  })
}

describe('groupsRouter.participants.remove — soft remove', () => {
  it('soft-hides an unlinked participant', async () => {
    await authAs('acct-admin')
    seedGroupContext()
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue({
      id: 'lp-unlinked',
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Imported Alex',
      ledgerId: 'ledger-1',
      removedAt: null,
      groupMemberId: null,
      groupMember: null,
      invitations: [],
    } as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({
      id: 'lp-unlinked',
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.participants.remove({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-unlinked',
    })

    expect(result).toEqual({
      ledgerParticipantId: 'lp-unlinked',
      kind: 'unlinked',
    })
    expect(prismaMock.ledgerParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lp-unlinked' },
        data: expect.objectContaining({ removedAt: expect.any(Date) }),
      }),
    )
    expect(prismaMock.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'PARTICIPANT_REMOVED' }),
      }),
    )
  })

  it('revokes a pending invitation and soft-hides its participant', async () => {
    await authAs('acct-admin')
    seedGroupContext()
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue({
      id: 'lp-invitee',
      kind: 'ACCOUNT_MEMBER',
      displayName: null,
      ledgerId: 'ledger-1',
      removedAt: null,
      groupMemberId: null,
      groupMember: null,
      invitations: [
        {
          id: 'inv-1',
          email: 'alex@example.com',
          temporaryName: 'Alex roommate',
        },
      ],
    } as never)
    prismaMock.groupInvitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: 'grp-1',
      email: 'alex@example.com',
      role: 'MEMBER',
      status: 'PENDING',
      ledgerParticipantId: 'lp-invitee',
      temporaryName: 'Alex roommate',
      group: { groupType: 'GROUP' },
    } as never)
    prismaMock.groupInvitation.update.mockResolvedValue({
      id: 'inv-1',
      status: 'REVOKED',
    } as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({
      id: 'lp-invitee',
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.participants.remove({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-invitee',
    })

    expect(result).toEqual({
      ledgerParticipantId: 'lp-invitee',
      kind: 'invitation',
    })
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

  it('removes an active member and soft-hides their participant', async () => {
    await authAs('acct-admin')
    seedGroupContext()
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue({
      id: 'lp-bob',
      kind: 'ACCOUNT_MEMBER',
      displayName: null,
      ledgerId: 'ledger-1',
      removedAt: null,
      groupMemberId: 'gm-bob',
      groupMember: {
        id: 'gm-bob',
        role: 'MEMBER',
        status: 'ACTIVE',
        account: { name: 'Bob' },
      },
      invitations: [],
    } as never)
    prismaMock.groupMember.findUnique
      .mockResolvedValueOnce({
        id: 'gm-admin',
        groupId: 'grp-1',
        accountId: 'acct-admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        ledgerParticipant: null,
      } as never)
      .mockResolvedValueOnce({
        id: 'gm-bob',
        groupId: 'grp-1',
        accountId: 'acct-bob',
        role: 'MEMBER',
        status: 'ACTIVE',
        ledgerParticipant: { id: 'lp-bob' },
        account: { name: 'Bob' },
      } as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-bob',
      status: 'REMOVED',
    } as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({
      id: 'lp-bob',
    } as never)
    prismaMock.groupMember.count.mockResolvedValue(1 as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.participants.remove({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-bob',
    })

    expect(result).toEqual({
      ledgerParticipantId: 'lp-bob',
      kind: 'member',
    })
    expect(prismaMock.groupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gm-bob' },
        data: expect.objectContaining({ status: 'REMOVED' }),
      }),
    )
    expect(prismaMock.ledgerParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lp-bob' },
        data: expect.objectContaining({ removedAt: expect.any(Date) }),
      }),
    )
  })

  it('rejects PRECONDITION_FAILED when an unlinked participant has unsettled balances and no decision', async () => {
    await authAs('acct-admin')
    seedGroupContext()
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue({
      id: 'lp-unlinked',
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Imported Alex',
      ledgerId: 'ledger-1',
      removedAt: null,
      groupMemberId: null,
      groupMember: null,
      invitations: [],
    } as never)
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-unlinked',
        paidFor: [
          { participantId: 'lp-unlinked', shares: 1 },
          { participantId: 'lp-admin', shares: 1 },
        ],
      }),
    ] as never)

    const caller = makeCaller('acct-admin')
    await expect(
      caller.participants.remove({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-unlinked',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
    expect(prismaMock.ledgerParticipant.update).not.toHaveBeenCalled()
  })

  it('preview reports participant kind and balance', async () => {
    await authAs('acct-admin')
    seedGroupContext()
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue({
      id: 'lp-unlinked',
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Imported Alex',
      ledgerId: 'ledger-1',
      removedAt: null,
      groupMemberId: null,
      groupMember: null,
      invitations: [],
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.participants.removePreview({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-unlinked',
    })

    expect(result).toEqual({
      participantName: 'Imported Alex',
      participantKind: 'unlinked',
      hasUnsettledBalance: false,
      currentBalance: 0,
      settlementLegs: [],
      currencyCode: 'USD',
      participants: [{ id: 'lp-unlinked', name: 'Imported Alex' }],
    })
  })

  it('preview returns settlement legs and counterparty names when unsettled', async () => {
    await authAs('acct-admin')
    seedGroupContext()
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue({
      id: 'lp-unlinked',
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Imported Alex',
      ledgerId: 'ledger-1',
      removedAt: null,
      groupMemberId: null,
      groupMember: null,
      invitations: [],
    } as never)
    prismaMock.expense.findMany.mockResolvedValue([
      makeExpenseRow({
        id: 'exp-1',
        amount: 100,
        paidById: 'lp-unlinked',
        paidFor: [
          { participantId: 'lp-unlinked', shares: 1 },
          { participantId: 'lp-admin', shares: 1 },
        ],
      }),
    ] as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        id: 'lp-admin',
        displayName: null,
        groupMember: { account: { name: 'Admin' } },
        invitations: [],
      },
    ] as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.participants.removePreview({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-unlinked',
    })

    expect(result.hasUnsettledBalance).toBe(true)
    expect(result.currentBalance).toBe(50)
    expect(result.currencyCode).toBe('USD')
    expect(result.settlementLegs).toEqual([
      { from: 'lp-admin', to: 'lp-unlinked', amount: 50 },
    ])
    expect(result.participants).toEqual([
      { id: 'lp-unlinked', name: 'Imported Alex' },
      { id: 'lp-admin', name: 'Admin' },
    ])
  })

  it('shortens a placeholder email in an invitation preview', async () => {
    await authAs('acct-admin')
    seedGroupContext()
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue({
      id: 'lp-invite',
      kind: 'UNLINKED_PARTICIPANT',
      displayName: null,
      ledgerId: 'ledger-1',
      removedAt: null,
      groupMemberId: null,
      groupMember: null,
      invitations: [
        {
          id: 'inv-link',
          email: 'abcdefghijk@link.placeholder.local',
          temporaryName: null,
        },
      ],
    } as never)

    const caller = makeCaller('acct-admin')
    const result = await caller.participants.removePreview({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-invite',
    })

    expect(result).toMatchObject({
      participantName: 'abcdefgh…',
      participantKind: 'invitation',
      participants: [{ id: 'lp-invite', name: 'abcdefgh…' }],
    })
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
        .participants.remove({
          groupId: 'grp-1',
          ledgerParticipantId: 'lp-unlinked',
        }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(prismaMock.ledgerParticipant.update).not.toHaveBeenCalled()
  })
})
