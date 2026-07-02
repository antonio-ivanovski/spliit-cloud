import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prismaMock, sendEmailMock } from '../../test/state'
import { ExpenseEmailActivityNotificationDispatcher } from './expense-email-dispatcher'
import type { ActivityNotificationEvent } from './types'

function buildEvent(
  overrides: Partial<ActivityNotificationEvent> = {},
): ActivityNotificationEvent {
  return {
    activityId: 'act-1',
    type: 'EXPENSE_CREATED',
    groupId: 'grp-1',
    actor: { type: 'ACCOUNT', id: 'acct-alice' },
    subject: { type: 'EXPENSE', id: 'exp-1' },
    data: {
      kind: 'expense',
      title: 'Dinner',
      amount: 4500,
      currencyCode: 'EUR',
      date: '2026-07-02',
    },
    occurredAt: new Date('2026-07-02T12:00:00Z'),
    ...overrides,
  }
}

function makeExpenseRow(overrides?: Record<string, unknown>) {
  return {
    paidByList: [{ ledgerParticipantId: 'lp-alice', shares: 4500 }],
    paidFor: [
      { ledgerParticipantId: 'lp-alice', shares: 1 },
      { ledgerParticipantId: 'lp-bob', shares: 1 },
    ],
    items: [],
    itemizedRemainder: null,
    ...overrides,
  }
}

function makeParticipant(
  lpId: string,
  overrides?: {
    status?: string
    accountId?: string
    email?: string
    name?: string
    hasGroupMember?: boolean
  },
) {
  const {
    status = 'ACTIVE',
    accountId = `acct-${lpId.replace('lp-', '')}`,
    email = `${lpId.replace('lp-', '')}@test.com`,
    name = lpId.replace('lp-', '').charAt(0).toUpperCase() +
      lpId.replace('lp-', '').slice(1),
    hasGroupMember = true,
  } = overrides ?? {}
  const base: Record<string, unknown> = { id: lpId }
  if (hasGroupMember) {
    base.groupMember = {
      id: `gm-${lpId}`,
      status,
      accountId,
      account: { id: accountId, email, name },
    }
  } else {
    base.groupMember = null
  }
  return base
}

const dispatcher = new ExpenseEmailActivityNotificationDispatcher()

beforeEach(() => {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-1',
    name: 'Test Group',
    ledgerId: 'ledger-1',
  } as never)
})

describe('ExpenseEmailActivityNotificationDispatcher', () => {
  describe('successful create email', () => {
    it('sends email to affected active participants for EXPENSE_CREATED', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice', { email: 'alice@test.com' }),
        makeParticipant('lp-bob', { email: 'bob@test.com' }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)

      await dispatcher.dispatch(buildEvent())

      // Alice is the actor so excluded; Bob gets the email
      expect(sendEmailMock).toHaveBeenCalledTimes(1)
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'bob@test.com',
          subject: expect.stringContaining(
            '[Spliit Cloud] Dinner was added in Test Group',
          ),
        }),
      )
      const email = sendEmailMock.mock.calls[0][0]
      expect(email.text).toContain('Alice')
      expect(email.text).toContain('Dinner')
      expect(email.text).toContain('EUR 45.00')
      expect(email.text).toContain('2026-07-02')
    })
  })

  describe('successful update email', () => {
    it('sends email with changed fields for EXPENSE_UPDATED', async () => {
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com' }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)

      const event = buildEvent({
        type: 'EXPENSE_UPDATED',
        data: {
          kind: 'expense',
          title: 'Dinner',
          amount: 5000,
          currencyCode: 'EUR',
          date: '2026-07-02',
          changedFields: ['amount', 'title'],
          affectedParticipants: ['lp-alice', 'lp-bob'],
        },
      })
      await dispatcher.dispatch(event)

      expect(sendEmailMock).toHaveBeenCalledTimes(1)
      const email = sendEmailMock.mock.calls[0][0]
      expect(email.subject).toContain('was updated in')
      expect(email.text).toContain('Alice updated')
      expect(email.text).toContain('EUR 50.00')
      expect(email.text).toContain('Changed: amount, title')
    })
  })

  describe('successful delete email', () => {
    it('sends email using affectedParticipants from event data for EXPENSE_DELETED', async () => {
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com' }),
        makeParticipant('lp-carol', { email: 'carol@test.com' }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)

      const event = buildEvent({
        type: 'EXPENSE_DELETED',
        data: {
          kind: 'expense',
          title: 'Dinner',
          amount: 4500,
          currencyCode: 'EUR',
          date: '2026-07-02',
          affectedParticipants: ['lp-alice', 'lp-bob', 'lp-carol'],
        },
      })
      await dispatcher.dispatch(event)

      // Alice excluded as actor; Bob and Carol get email
      expect(sendEmailMock).toHaveBeenCalledTimes(2)
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'bob@test.com' }),
      )
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'carol@test.com' }),
      )
      const email = sendEmailMock.mock.calls[0][0]
      expect(email.subject).toContain('was removed in')
      expect(email.text).toContain('Alice removed')
    })
  })

  describe('actor exclusion', () => {
    it('does not send email to the actor', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice', {
          accountId: 'acct-alice',
          email: 'alice@test.com',
        }),
      ] as never)

      await dispatcher.dispatch(buildEvent())

      expect(sendEmailMock).not.toHaveBeenCalled()
    })
  })

  describe('pending invitee skipped', () => {
    it('skips participant with no groupMember', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(
        makeExpenseRow({
          paidFor: [{ ledgerParticipantId: 'lp-pending', shares: 1 }],
        }) as never,
      )
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-pending', { hasGroupMember: false }),
        makeParticipant('lp-alice'),
      ] as never)

      await dispatcher.dispatch(buildEvent())

      // Alice (actor) excluded, pending invitee skipped → no email
      expect(sendEmailMock).not.toHaveBeenCalled()
    })
  })

  describe('left member skipped', () => {
    it('skips participant with groupMember status LEFT', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com', status: 'LEFT' }),
      ] as never)

      await dispatcher.dispatch(buildEvent())

      expect(sendEmailMock).not.toHaveBeenCalled()
    })
  })

  describe('removed member skipped', () => {
    it('skips participant with groupMember status REMOVED', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com', status: 'REMOVED' }),
      ] as never)

      await dispatcher.dispatch(buildEvent())

      expect(sendEmailMock).not.toHaveBeenCalled()
    })
  })

  describe('placeholder email skipped', () => {
    it('skips participant with placeholder email', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', {
          email: 'github-oidc-abc123@github.placeholder.local',
        }),
      ] as never)

      await dispatcher.dispatch(buildEvent())

      expect(sendEmailMock).not.toHaveBeenCalled()
    })
  })

  describe('active removed-from-expense update recipient included', () => {
    it('includes participant removed from expense on update', async () => {
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com' }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)

      await dispatcher.dispatch(
        buildEvent({
          type: 'EXPENSE_UPDATED',
          data: {
            kind: 'expense',
            title: 'Dinner',
            amount: 4500,
            currencyCode: 'EUR',
            date: '2026-07-02',
            changedFields: ['split'],
            affectedParticipants: ['lp-alice', 'lp-bob'],
          },
        }),
      )

      // Bob is in affectedParticipants (was in old expense) and is ACTIVE → gets email
      expect(sendEmailMock).toHaveBeenCalledTimes(1)
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'bob@test.com' }),
      )
    })
  })

  describe('sendEmail throws', () => {
    it('catches error, logs warn, does not throw', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com' }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)

      sendEmailMock.mockRejectedValueOnce(new Error('SMTP down'))

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await expect(dispatcher.dispatch(buildEvent())).resolves.toBeUndefined()

      expect(warn).toHaveBeenCalled()
      const logMsg = warn.mock.calls[0].join(' ')
      expect(logMsg).toContain('act-1')
      expect(logMsg).toContain('SMTP down')

      warn.mockRestore()
    })
  })

  describe('non-expense event', () => {
    it('does not call sendEmail for GROUP_UPDATED', async () => {
      await dispatcher.dispatch(
        buildEvent({
          type: 'GROUP_UPDATED',
          data: { kind: 'group', summary: 'Name changed' },
        }),
      )

      expect(sendEmailMock).not.toHaveBeenCalled()
    })
  })
})
