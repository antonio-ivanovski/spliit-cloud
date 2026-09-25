import { beforeEach, describe, expect, it } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import {
  ensureAccountIncludedAsParticipant,
  EXPENSE_GROUP_SELECT,
  loadActivityChannelContext,
  loadActivityGroupAndActor,
  loadActivityRecipientMember,
  resolveCreatedExpenseRecipientIds,
} from './expense-notification-shared'

describe('resolveCreatedExpenseRecipientIds', () => {
  beforeEach(() => {
    prismaMock.expense.findUnique.mockResolvedValue({
      paidByList: [{ ledgerParticipantId: 'lp-alice', shares: 4500 }],
      paidFor: [
        { ledgerParticipantId: 'lp-alice', shares: 1 },
        { ledgerParticipantId: 'lp-bob', shares: 1 },
      ],
      items: [],
      itemizedRemainder: null,
    } as never)
  })

  it('returns the union of ledger participant ids from the loaded expense', async () => {
    const ids = await resolveCreatedExpenseRecipientIds('exp-1')
    expect(ids.sort()).toEqual(['lp-alice', 'lp-bob'])
  })

  it('returns an empty list when the expense cannot be found', async () => {
    prismaMock.expense.findUnique.mockResolvedValueOnce(null)
    expect(await resolveCreatedExpenseRecipientIds('missing')).toEqual([])
  })
})

describe('ensureAccountIncludedAsParticipant', () => {
  beforeEach(() => {
    prismaMock.groupMember.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      account: { id: 'acct-alice', email: 'alice@test', name: 'Alice' },
    } as never)
  })

  it('appends the targeted member when not already present', async () => {
    const result = await ensureAccountIncludedAsParticipant({
      groupId: 'grp-1',
      participants: [
        {
          groupMember: {
            status: 'ACTIVE',
            account: { id: 'acct-bob', name: 'Bob', email: 'bob@test' },
          },
        },
      ],
      accountId: 'acct-alice',
    })
    expect(result).toHaveLength(2)
    expect(result[1]?.groupMember?.account?.id).toBe('acct-alice')
  })

  it('returns the input unchanged when the account already appears', async () => {
    const input = [
      {
        groupMember: {
          status: 'ACTIVE',
          account: { id: 'acct-alice', name: 'Alice', email: 'alice@test' },
        },
      },
    ]
    const result = await ensureAccountIncludedAsParticipant({
      groupId: 'grp-1',
      participants: input,
      accountId: 'acct-alice',
    })
    expect(result).toBe(input)
  })

  it('returns the input unchanged when the member lookup returns nothing', async () => {
    prismaMock.groupMember.findFirst.mockResolvedValueOnce(null)
    const input = [
      {
        groupMember: {
          status: 'ACTIVE',
          account: { id: 'acct-bob', name: 'Bob', email: 'bob@test' },
        },
      },
    ]
    const result = await ensureAccountIncludedAsParticipant({
      groupId: 'grp-1',
      participants: input,
      accountId: 'acct-x',
    })
    expect(result).toBe(input)
  })
})

describe('loadActivityChannelContext', () => {
  beforeEach(() => {
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      {
        groupMember: {
          accountId: 'acct-alice',
          status: 'ACTIVE',
          account: { id: 'acct-alice', name: 'Alice', email: 'alice@test' },
        },
      },
    ] as never)
    prismaMock.group.findUnique.mockResolvedValue({
      name: 'Trip',
      groupType: 'GROUP',
      members: [],
      invitations: [],
    } as never)
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Alice' } as never)
  })

  it('returns participants, group, and a resolved actor name', async () => {
    const result = await loadActivityChannelContext({
      groupId: 'grp-1',
      participantIds: ['lp-alice'],
      actor: { type: 'ACCOUNT', id: 'acct-alice' },
    })
    expect(result.participants).toHaveLength(1)
    expect(result.group?.name).toBe('Trip')
    expect(result.actorName).toBe('Alice')
  })

  it('falls back to "Someone" when the actor is not an ACCOUNT', async () => {
    const result = await loadActivityChannelContext({
      groupId: 'grp-1',
      participantIds: [],
      actor: null,
    })
    expect(result.actorName).toBe('Someone')
  })
})

describe('loadActivityGroupAndActor', () => {
  beforeEach(() => {
    prismaMock.group.findUnique.mockResolvedValue({
      name: 'Trip',
      groupType: 'GROUP',
      members: [],
      invitations: [],
    } as never)
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Alice' } as never)
  })

  it('returns group and actor name', async () => {
    const result = await loadActivityGroupAndActor({
      groupId: 'grp-1',
      actor: { type: 'ACCOUNT', id: 'acct-alice' },
    })
    expect(result.group?.name).toBe('Trip')
    expect(result.actorName).toBe('Alice')
  })
})

describe('loadActivityRecipientMember', () => {
  it('returns the active recipient member', async () => {
    prismaMock.groupMember.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      account: { id: 'acct-bob', name: 'Bob', email: 'bob@test' },
    } as never)
    const result = await loadActivityRecipientMember({
      groupId: 'grp-1',
      recipientAccountId: 'acct-bob',
    })
    expect(result).toEqual({
      status: 'ACTIVE',
      account: { id: 'acct-bob', name: 'Bob', email: 'bob@test' },
    })
  })

  it('returns null when no active member is found', async () => {
    prismaMock.groupMember.findFirst.mockResolvedValueOnce(null)
    expect(
      await loadActivityRecipientMember({
        groupId: 'grp-1',
        recipientAccountId: 'acct-x',
      }),
    ).toBeNull()
  })
})

describe('EXPENSE_GROUP_SELECT', () => {
  it('uses ACTIVE-only membership with a 2-row cap and one pending invitation', () => {
    expect(EXPENSE_GROUP_SELECT.members.where).toEqual({ status: 'ACTIVE' })
    expect(EXPENSE_GROUP_SELECT.members.take).toBe(2)
    expect(EXPENSE_GROUP_SELECT.invitations.where).toEqual({
      status: 'PENDING',
    })
    expect(EXPENSE_GROUP_SELECT.invitations.take).toBe(1)
  })
})
