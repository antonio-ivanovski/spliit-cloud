import { describe, expect, it } from 'vitest'

import {
  isActivityInvolvingUser,
  type ActivityInvolvementExpense,
} from './activity-involvement'

function expense(
  paidByIds: string[],
  paidForIds: string[],
): ActivityInvolvementExpense {
  const side = (id: string) => ({ ledgerParticipant: { id } })
  return { paidByList: paidByIds.map(side), paidFor: paidForIds.map(side) }
}

describe('isActivityInvolvingUser', () => {
  it('treats everything as involving when no identity is known', () => {
    expect(
      isActivityInvolvingUser(
        {
          data: { kind: 'expense', affectedParticipants: ['lp-other'] },
          expense: expense(['lp-other'], ['lp-other']),
        },
        null,
        null,
      ),
    ).toBe(true)
  })

  it('prefers the stored snapshot over live splits', () => {
    // Removed by a later edit: snapshot says involving, live splits don't.
    expect(
      isActivityInvolvingUser(
        {
          data: { kind: 'expense', affectedParticipants: ['lp-me'] },
          expense: expense(['lp-other'], ['lp-other']),
        },
        'lp-me',
        'acct-me',
      ),
    ).toBe(true)
    // Added by a later edit: snapshot says not involving, live splits do.
    expect(
      isActivityInvolvingUser(
        {
          data: { kind: 'expense', affectedParticipants: ['lp-other'] },
          expense: expense(['lp-me'], ['lp-me']),
        },
        'lp-me',
        'acct-me',
      ),
    ).toBe(false)
  })

  it('matches the stored snapshot by participant id', () => {
    expect(
      isActivityInvolvingUser(
        {
          data: { kind: 'expense', affectedParticipants: ['lp-me'] },
          expense: null,
        },
        'lp-me',
        'acct-me',
      ),
    ).toBe(true)
    expect(
      isActivityInvolvingUser(
        {
          data: { kind: 'expense', affectedParticipants: ['lp-other'] },
          expense: null,
        },
        'lp-me',
        'acct-me',
      ),
    ).toBe(false)
  })

  it('matches import summaries by stored snapshot', () => {
    expect(
      isActivityInvolvingUser(
        {
          data: { kind: 'import_summary', affectedParticipants: ['lp-me'] },
          expense: null,
        },
        'lp-me',
        null,
      ),
    ).toBe(true)
    expect(
      isActivityInvolvingUser(
        {
          data: { kind: 'import_summary', affectedParticipants: ['lp-other'] },
          expense: null,
        },
        'lp-me',
        null,
      ),
    ).toBe(false)
  })

  it('matches recurring stop rows by stored snapshot', () => {
    expect(
      isActivityInvolvingUser(
        {
          data: {
            kind: 'recurring_expense_stopped',
            affectedParticipants: ['lp-me'],
          },
          expense: null,
        },
        'lp-me',
        null,
      ),
    ).toBe(true)
    expect(
      isActivityInvolvingUser(
        {
          data: {
            kind: 'recurring_expense_stopped',
            affectedParticipants: ['lp-other'],
          },
          expense: null,
        },
        'lp-me',
        null,
      ),
    ).toBe(false)
  })

  it('falls back to live splits for pre-backfill rows', () => {
    expect(
      isActivityInvolvingUser(
        { data: { kind: 'expense' }, expense: expense(['lp-me'], []) },
        'lp-me',
        null,
      ),
    ).toBe(true)
    expect(
      isActivityInvolvingUser(
        {
          data: { kind: 'expense' },
          expense: expense(['lp-other'], ['lp-other']),
        },
        'lp-me',
        'acct-me',
      ),
    ).toBe(false)
  })

  it('matches live splits by account id', () => {
    const withAccount = {
      paidByList: [],
      paidFor: [
        { ledgerParticipant: { id: 'lp-x', account: { id: 'acct-me' } } },
      ],
    }
    expect(
      isActivityInvolvingUser(
        { data: { kind: 'expense' }, expense: withAccount },
        'lp-me',
        'acct-me',
      ),
    ).toBe(true)
  })

  it('shows account-only viewers everything when only a snapshot exists', () => {
    expect(
      isActivityInvolvingUser(
        {
          data: { kind: 'expense', affectedParticipants: ['lp-other'] },
          expense: null,
        },
        null,
        'acct-me',
      ),
    ).toBe(true)
  })

  it('treats an empty snapshot as unknown (visible)', () => {
    expect(
      isActivityInvolvingUser(
        { data: { kind: 'expense', affectedParticipants: [] }, expense: null },
        'lp-me',
        'acct-me',
      ),
    ).toBe(true)
  })

  it('always shows non-expense and unknown rows', () => {
    expect(
      isActivityInvolvingUser(
        { data: { kind: 'group' }, expense: null },
        'lp-me',
        'acct-me',
      ),
    ).toBe(true)
    expect(
      isActivityInvolvingUser(
        { data: null, expense: null },
        'lp-me',
        'acct-me',
      ),
    ).toBe(true)
  })
})
