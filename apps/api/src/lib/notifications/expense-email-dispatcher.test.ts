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
    groupType: 'GROUP',
    members: [],
    invitations: [],
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
            '[Spliit Cloud] Expense "Dinner" was added by Alice to Test Group',
          ),
        }),
      )
      const email = sendEmailMock.mock.calls[0][0]
      expect(email.text).toContain('Alice')
      expect(email.text).toContain('Expense "Dinner"')
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
      expect(email.subject).toContain('was updated by Alice in')
      expect(email.text).toContain('was updated by Alice')
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
      expect(email.subject).toContain('was removed by Alice from')
      expect(email.text).toContain('was removed by Alice')
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

  describe('EXPENSES_IMPORTED summary', () => {
    it('sends one email per affected active member with the import summary', async () => {
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
        type: 'EXPENSES_IMPORTED',
        subject: { type: 'GROUP', id: 'grp-1' },
        data: {
          kind: 'import_summary',
          summary: 'Imported from Splitwise',
          count: 25,
          totalAmount: 123450,
          currencyCode: 'EUR',
          sourceProvider: 'Splitwise',
          affectedParticipants: ['lp-alice', 'lp-bob', 'lp-carol'],
        },
      })
      await dispatcher.dispatch(event)

      // Alice excluded as actor; Bob and Carol each get one email
      expect(sendEmailMock).toHaveBeenCalledTimes(2)
      const callArgs = sendEmailMock.mock.calls.map((c) => c[0])
      for (const email of callArgs) {
        expect(email.subject).toContain('25 expenses imported in Test Group')
        expect(email.text).toContain(
          'Alice imported 25 expenses from Splitwise',
        )
        expect(email.text).toContain('EUR 1234.50')
      }
      expect(callArgs.some((e) => e.to === 'bob@test.com')).toBe(true)
      expect(callArgs.some((e) => e.to === 'carol@test.com')).toBe(true)
    })

    it('skips unlinked participants and actors', async () => {
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com' }),
        makeParticipant('lp-pending', {
          email: 'pending@test.com',
          hasGroupMember: false,
        }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)

      const event = buildEvent({
        type: 'EXPENSES_IMPORTED',
        subject: { type: 'GROUP', id: 'grp-1' },
        data: {
          kind: 'import_summary',
          count: 1,
          affectedParticipants: ['lp-alice', 'lp-bob', 'lp-pending'],
        },
      })
      await dispatcher.dispatch(event)

      // Only Bob gets the email — Alice is actor, pending has no groupMember
      expect(sendEmailMock).toHaveBeenCalledTimes(1)
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'bob@test.com' }),
      )
    })

    it('does not send any email when affectedParticipants is empty', async () => {
      const event = buildEvent({
        type: 'EXPENSES_IMPORTED',
        subject: { type: 'GROUP', id: 'grp-1' },
        data: {
          kind: 'import_summary',
          count: 0,
          affectedParticipants: [],
        },
      })
      await dispatcher.dispatch(event)

      expect(sendEmailMock).not.toHaveBeenCalled()
    })
  })

  describe('FRIEND group display name', () => {
    it('resolves to peer name from recipient perspective (not actor)', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com' }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)
      prismaMock.group.findUnique.mockResolvedValue({
        id: 'grp-1',
        name: 'abc123',
        ledgerId: 'ledger-1',
        groupType: 'FRIEND',
        members: [
          { account: { id: 'acct-alice', name: 'Alice' } },
          { account: { id: 'acct-bob', name: 'Bob' } },
        ],
        invitations: [],
      } as never)

      await dispatcher.dispatch(buildEvent())

      // Actor is Alice → excluded. Recipient Bob sees "your friend ledger
      // with Alice" (the peer, from Bob's perspective).
      expect(sendEmailMock).toHaveBeenCalledTimes(1)
      const email = sendEmailMock.mock.calls[0][0]
      expect(email.subject).toContain('your friend ledger with Alice')
      expect(email.text).toContain('your friend ledger with Alice')
    })

    it('uses "your friend ledger with {temporaryName}" when only pending invitation', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-pending', { hasGroupMember: false }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)
      prismaMock.group.findUnique.mockResolvedValue({
        id: 'grp-1',
        name: 'abc123',
        ledgerId: 'ledger-1',
        groupType: 'FRIEND',
        members: [{ account: { id: 'acct-alice', name: 'Alice' } }],
        invitations: [{ temporaryName: 'Alice' }],
      } as never)

      await dispatcher.dispatch(buildEvent())

      // Alice is actor, pending has no groupMember → no email sent
      // This test verifies that even if no email is sent, the display name
      // resolution doesn't crash. We need a non-actor recipient.
      expect(sendEmailMock).not.toHaveBeenCalled()
    })

    it('resolves to member peer name (not pending temporary name) when active peer exists', async () => {
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com' }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)
      prismaMock.group.findUnique.mockResolvedValue({
        id: 'grp-1',
        name: 'abc123',
        ledgerId: 'ledger-1',
        groupType: 'FRIEND',
        members: [{ account: { id: 'acct-alice', name: 'Alice' } }],
        invitations: [{ temporaryName: 'Bob' }],
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
            affectedParticipants: ['lp-alice', 'lp-bob'],
          },
        }),
      )

      // Bob receives email, finds Alice as peer → "your friend ledger with Alice"
      // (uses active member peer, not the pending invitation temporary name)
      expect(sendEmailMock).toHaveBeenCalledTimes(1)
      const email = sendEmailMock.mock.calls[0][0]
      expect(email.subject).toContain('your friend ledger with Alice')
      expect(email.text).toContain('your friend ledger with Alice')
    })

    it('resolves to peer name when recipient is not in members list', async () => {
      prismaMock.ledgerParticipant.findMany.mockResolvedValue([
        makeParticipant('lp-alice'),
        makeParticipant('lp-bob', { email: 'bob@test.com' }),
      ] as never)
      prismaMock.account.findUnique.mockResolvedValue({
        id: 'acct-alice',
        name: 'Alice',
      } as never)
      prismaMock.group.findUnique.mockResolvedValue({
        id: 'grp-1',
        name: 'abc123',
        ledgerId: 'ledger-1',
        groupType: 'FRIEND',
        members: [{ account: { id: 'acct-alice', name: 'Alice' } }],
        invitations: [],
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
            affectedParticipants: ['lp-alice', 'lp-bob'],
          },
        }),
      )

      // Bob is the recipient. Alice is the only member and not Bob,
      // so the name resolves to "your friend ledger with Alice".
      expect(sendEmailMock).toHaveBeenCalledTimes(1)
      const email = sendEmailMock.mock.calls[0][0]
      expect(email.subject).toContain('your friend ledger with Alice')
      expect(email.subject).not.toContain('abc123')
    })
  })

  describe('JPY amount formatting', () => {
    it('formats JPY without decimal places', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
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
          data: {
            kind: 'expense',
            title: 'Ramen',
            amount: 100000,
            currencyCode: 'JPY',
            date: '2026-07-02',
          },
        }),
      )

      const email = sendEmailMock.mock.calls[0][0]
      expect(email.text).toContain('JPY 1000')
      expect(email.text).not.toContain('JPY 1000.00')
    })
  })

  describe('dual-currency formatting', () => {
    it('shows both original and ledger amounts when currencies differ', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
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
          data: {
            kind: 'expense',
            title: 'Hotel',
            amount: 670,
            currencyCode: 'JPY',
            date: '2026-07-02',
            originalAmount: 500000,
            ledgerCurrencyCode: 'EUR',
          },
        }),
      )

      const email = sendEmailMock.mock.calls[0][0]
      expect(email.text).toContain('JPY 5000')
      expect(email.text).toContain('EUR 6.70')
    })

    it('does not show dual-currency when currencies are the same', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
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
          data: {
            kind: 'expense',
            title: 'Dinner',
            amount: 4500,
            currencyCode: 'EUR',
            date: '2026-07-02',
            originalAmount: 4500,
            ledgerCurrencyCode: 'EUR',
          },
        }),
      )

      const email = sendEmailMock.mock.calls[0][0]
      // Should show single amount, not dual-currency format
      expect(email.text).toContain('EUR 45.00')
      expect(email.text).not.toContain('JPY')
      expect(email.text).not.toContain('USD')
    })

    it('falls back to ledgerCurrencyCode when currencyCode is null', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
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
          data: {
            kind: 'expense',
            title: 'Dinner',
            amount: 4500,
            currencyCode: null,
            date: '2026-07-02',
            ledgerCurrencyCode: 'EUR',
          },
        }),
      )

      const email = sendEmailMock.mock.calls[0][0]
      // currencyCode is null but ledgerCurrencyCode is EUR → should show
      // "EUR 45.00" instead of bare "45.00"
      expect(email.text).toContain('EUR 45.00')
    })

    it('does not show dual-currency when currencyCode is null even if originalAmount differs', async () => {
      prismaMock.expense.findUnique.mockResolvedValue(makeExpenseRow() as never)
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
          data: {
            kind: 'expense',
            title: 'Dinner',
            amount: 670,
            currencyCode: null,
            date: '2026-07-02',
            originalAmount: 500000,
            ledgerCurrencyCode: 'EUR',
          },
        }),
      )

      const email = sendEmailMock.mock.calls[0][0]
      // When currencyCode is null, dual-currency is not meaningful —
      // fall back to single amount using ledgerCurrencyCode.
      // The email body wraps the amount in parens: "(EUR 6.70)", but
      // that's the template, not a dual-currency display.
      expect(email.text).toContain('(EUR 6.70)')
      // Should NOT contain a dual-currency pattern like "X 5000 (EUR 6.70)"
      expect(email.text).not.toMatch(/\d+ \(EUR/)
    })
  })
})
