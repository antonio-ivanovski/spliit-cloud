import { NotificationCategory } from '@spliit/domain/notifications'
import { beforeEach, describe, expect, it } from 'vitest'
import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { ExpenseActivityHandler } from './handlers'
import type { ActivityNotificationEvent } from './types'

function event(
  overrides: Partial<ActivityNotificationEvent> = {},
): ActivityNotificationEvent {
  return {
    activityId: 'activity-1',
    type: 'EXPENSE_CREATED',
    groupId: 'group-1',
    actor: { type: 'ACCOUNT', id: 'account-alice' },
    subject: { type: 'EXPENSE', id: 'expense-1' },
    data: { kind: 'expense', title: 'Dinner' },
    occurredAt: new Date('2026-07-22T00:00:00Z'),
    ...overrides,
  }
}

describe('ExpenseActivityHandler recurring recipients', () => {
  beforeEach(() => {
    prismaMock.expense.findUnique.mockResolvedValue({
      paidByList: [{ ledgerParticipantId: 'lp-bob', shares: 100 }],
      paidFor: [{ ledgerParticipantId: 'lp-bob', shares: 100 }],
      items: [],
      itemizedRemainder: null,
    } as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      { groupMember: { accountId: 'account-bob', status: 'ACTIVE' } },
    ] as never)
  })

  it('continues excluding the actor for ordinary expense creation', async () => {
    const intents = await new ExpenseActivityHandler().buildIntents(event())
    expect(intents.map((intent) => intent.recipientAccountId)).toEqual([
      'account-bob',
    ])
    expect(prismaMock.groupMember.findFirst).not.toHaveBeenCalled()
  })

  it('includes an active original creator for recurring creation', async () => {
    prismaMock.groupMember.findFirst.mockResolvedValue({
      accountId: 'account-alice',
    } as never)

    const intents = await new ExpenseActivityHandler().buildIntents(
      event({
        type: 'RECURRING_EXPENSE_CREATED',
        includeActorAsRecipient: true,
      }),
    )

    expect(intents.map((intent) => intent.recipientAccountId)).toEqual([
      'account-bob',
      'account-alice',
    ])
    expect(
      intents.every(
        (intent) =>
          intent.category === NotificationCategory.RECURRING_EXPENSE_CREATED,
      ),
    ).toBe(true)
  })

  it('does not include a creator who is no longer an active member', async () => {
    prismaMock.groupMember.findFirst.mockResolvedValue(null)

    const intents = await new ExpenseActivityHandler().buildIntents(
      event({
        type: 'RECURRING_EXPENSE_CREATED',
        includeActorAsRecipient: true,
      }),
    )

    expect(intents.map((intent) => intent.recipientAccountId)).toEqual([
      'account-bob',
    ])
  })
})
