import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { Activity } from './activity-item'
import { ActivityItem } from './activity-item'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

function makeActivity(
  overrides: Partial<Activity> & {
    type: Activity['type']
    data?: Activity['data']
  },
): Activity {
  return {
    id: 'act-1',
    ledgerId: 'ledger-1',
    time: new Date('2025-06-15T12:00:00Z'),
    actorType: 'ACCOUNT',
    actorId: 'user-1',
    subjectType: null,
    subjectId: null,
    actorName: 'Alice',
    expense: null,
    ...overrides,
  } as Activity
}

function renderItem(activity: Activity) {
  return render(
    <ActivityItem groupId="group-1" activity={activity} dateStyle="medium" />,
  )
}

describe('ActivityItem', () => {
  it('renders recurring expense creation distinctly', () => {
    renderItem(
      makeActivity({
        type: 'RECURRING_EXPENSE_CREATED',
        data: { kind: 'expense', title: 'Rent' },
      }),
    )
    expect(
      screen.getByText(/Alice created recurring expense .*Rent/),
    ).toBeInTheDocument()
  })

  it('renders expense created', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_CREATED',
        data: { kind: 'expense', title: 'Dinner' },
      }),
    )
    expect(screen.getByTestId('activity-item-act-1')).toBeInTheDocument()
    expect(screen.getByText(/Alice created expense Dinner/)).toBeInTheDocument()
  })

  it('renders expense updated with changed fields', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_UPDATED',
        data: {
          kind: 'expense',
          title: 'Dinner',
          changedFields: ['amount', 'date'],
        },
      }),
    )
    expect(screen.getByText(/Alice updated expense Dinner/)).toBeInTheDocument()
    // No "Changed:" summary anymore.
    expect(screen.queryByText(/Changed:/)).toBeNull()
    // No detail rows because there's no `changes` array.
    expect(screen.queryByTestId('activity-item-act-1-change-amount')).toBeNull()
  })

  it('renders expense updated without changed fields', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_UPDATED',
        data: { kind: 'expense', title: 'Lunch' },
      }),
    )
    expect(screen.getByText(/Alice updated expense Lunch/)).toBeInTheDocument()
  })

  it('renders expense updated with change rows', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_UPDATED',
        data: {
          kind: 'expense',
          title: 'Dinner',
          changedFields: ['amount', 'payers'],
          changes: [
            { field: 'amount', before: 'EUR 12.00', after: 'EUR 15.00' },
            { field: 'payers', before: 'Alice', after: 'Alice, Bob' },
          ],
        },
      }),
    )
    expect(screen.getByText(/Alice updated expense Dinner/)).toBeInTheDocument()
    // No "Changed:" summary.
    expect(screen.queryByText(/Changed:/)).toBeNull()
    // Field labels are capitalized display labels.
    expect(screen.getByText('Amount')).toBeInTheDocument()
    expect(screen.getByText('Paid by')).toBeInTheDocument()
    // Before/after values render with arrow.
    const changeAmount = screen.getByTestId('activity-item-act-1-change-amount')
    expect(changeAmount.textContent).toMatch(/EUR 12.00.*→.*EUR 15.00/)
    const changePayers = screen.getByTestId('activity-item-act-1-change-payers')
    expect(changePayers.textContent).toMatch(/Alice.*→.*Alice, Bob/)
  })

  it('renders expense updated with changed fields but no changes (legacy compatibility)', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_UPDATED',
        data: {
          kind: 'expense',
          title: 'Lunch',
          changedFields: ['amount', 'date'],
          // No `changes` array — legacy row
        },
      }),
    )
    expect(screen.getByText(/Alice updated expense Lunch/)).toBeInTheDocument()
    // No "Changed:" summary and no detail rows for legacy rows.
    expect(screen.queryByText(/Changed:/)).toBeNull()
    expect(screen.queryByTestId('activity-item-act-1-change-amount')).toBeNull()
  })

  it('renders expense deleted', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_DELETED',
        data: { kind: 'expense', title: 'Old Dinner' },
      }),
    )
    expect(
      screen.getByText(/Alice deleted expense Old Dinner/),
    ).toBeInTheDocument()
  })

  it('renders expense created from payload title when expense object missing', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_CREATED',
        data: { kind: 'expense', title: 'From Data' },
        expense: null,
      }),
    )
    expect(
      screen.getByText(/Alice created expense From Data/),
    ).toBeInTheDocument()
  })

  it('renders an expense comment with its author snapshot and excerpt', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_COMMENTED',
        actorName: null,
        subjectType: 'EXPENSE',
        subjectId: 'expense-1',
        data: {
          kind: 'expense_comment',
          commentId: 'comment-1',
          expenseTitle: 'Dinner',
          authorName: 'Former account',
          excerpt: 'Bring the receipt.',
        },
      }),
    )
    expect(
      screen.getByText(
        /Former account commented on Dinner: “Bring the receipt.”/,
      ),
    ).toBeInTheDocument()
  })

  it('renders group updated', () => {
    renderItem(
      makeActivity({
        type: 'GROUP_UPDATED',
        data: { kind: 'group' },
      }),
    )
    expect(screen.getByText(/Alice updated group settings/)).toBeInTheDocument()
  })

  it('renders group updated with change rows', () => {
    renderItem(
      makeActivity({
        type: 'GROUP_UPDATED',
        data: {
          kind: 'group',
          changedFields: ['name', 'currency'],
          changes: [
            { field: 'name', before: 'Old Name', after: 'New Name' },
            { field: 'currency', before: 'USD ($)', after: 'EUR (€)' },
          ],
        },
      }),
    )
    expect(screen.getByText(/Alice updated group settings/)).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Currency')).toBeInTheDocument()
    const changeName = screen.getByTestId('activity-item-act-1-change-name')
    expect(changeName.textContent).toMatch(/Old Name.*→.*New Name/)
    const changeCurrency = screen.getByTestId(
      'activity-item-act-1-change-currency',
    )
    expect(changeCurrency.textContent).toMatch(/USD \(\$\).*→.*EUR \(€\)/)
  })

  it('renders group updated with linkedParticipant change', () => {
    renderItem(
      makeActivity({
        type: 'GROUP_UPDATED',
        data: {
          kind: 'group',
          changedFields: ['linkedParticipant'],
          changes: [
            {
              field: 'linkedParticipant',
              before: 'Guest User',
              after: 'Alice',
            },
          ],
        },
      }),
    )
    expect(screen.getByText(/Alice updated group settings/)).toBeInTheDocument()
    expect(screen.getByText('Linked participant')).toBeInTheDocument()
    const change = screen.getByTestId(
      'activity-item-act-1-change-linkedParticipant',
    )
    expect(change.textContent).toMatch(/Guest User.*→.*Alice/)
  })

  it('renders group updated with changes but no changedFields (backward compat)', () => {
    renderItem(
      makeActivity({
        type: 'GROUP_UPDATED',
        data: {
          kind: 'group',
          changes: [{ field: 'name', before: 'Old', after: 'New' }],
        },
      }),
    )
    expect(screen.getByText(/Alice updated group settings/)).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    const change = screen.getByTestId('activity-item-act-1-change-name')
    expect(change.textContent).toMatch(/Old.*→.*New/)
  })

  it('renders group archived', () => {
    renderItem(
      makeActivity({
        type: 'GROUP_ARCHIVED',
        data: { kind: 'group' },
      }),
    )
    expect(screen.getByText(/Alice archived the group/)).toBeInTheDocument()
  })

  it('renders group unarchived', () => {
    renderItem(
      makeActivity({
        type: 'GROUP_UNARCHIVED',
        data: { kind: 'group' },
      }),
    )
    expect(screen.getByText(/Alice unarchived the group/)).toBeInTheDocument()
  })

  it('renders invitation created', () => {
    renderItem(
      makeActivity({
        type: 'INVITATION_CREATED',
        data: { kind: 'invitation', displayLabel: 'bob@example.com' },
      }),
    )
    expect(
      screen.getByText(/Alice invited bob@example.com/),
    ).toBeInTheDocument()
  })

  it('renders invitation revoked', () => {
    renderItem(
      makeActivity({
        type: 'INVITATION_REVOKED',
        data: { kind: 'invitation', displayLabel: 'bob@example.com' },
      }),
    )
    expect(
      screen.getByText(/Alice revoked invitation to bob@example.com/),
    ).toBeInTheDocument()
  })

  it('renders invitation accepted', () => {
    renderItem(
      makeActivity({
        type: 'INVITATION_ACCEPTED',
        data: { kind: 'invitation', displayLabel: 'Bob' },
      }),
    )
    expect(screen.getByText(/Bob accepted the invitation/)).toBeInTheDocument()
  })

  it('renders invitation declined', () => {
    renderItem(
      makeActivity({
        type: 'INVITATION_DECLINED',
        data: { kind: 'invitation', displayLabel: 'Bob' },
      }),
    )
    expect(screen.getByText(/Bob declined the invitation/)).toBeInTheDocument()
  })

  it('renders member left', () => {
    renderItem(
      makeActivity({
        type: 'MEMBER_LEFT',
        data: { kind: 'member', displayName: 'Bob' },
      }),
    )
    expect(screen.getByText(/Alice left the group/)).toBeInTheDocument()
  })

  it('renders member removed', () => {
    renderItem(
      makeActivity({
        type: 'MEMBER_REMOVED',
        data: { kind: 'member', targetDisplayName: 'Bob' },
      }),
    )
    expect(
      screen.getByText(/Alice removed Bob from the group/),
    ).toBeInTheDocument()
  })

  it('renders member role changed', () => {
    renderItem(
      makeActivity({
        type: 'MEMBER_ROLE_CHANGED',
        data: {
          kind: 'member',
          targetDisplayName: 'Bob',
          previousRole: 'MEMBER',
          nextRole: 'ADMIN',
        },
      }),
    )
    expect(
      screen.getByText(/Alice changed Bob.s role from MEMBER to ADMIN/),
    ).toBeInTheDocument()
  })

  it('renders EXPENSES_IMPORTED with count', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSES_IMPORTED',
        subjectType: 'GROUP',
        subjectId: 'group-1',
        data: {
          kind: 'import_summary',
          count: 25,
          sourceProvider: 'Splitwise',
          affectedParticipants: ['lp-alice', 'lp-bob'],
        },
      }),
    )
    expect(screen.getByText(/Alice imported 25 expenses/)).toBeInTheDocument()
  })

  it('renders fallback for null data', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_CREATED',
        data: null,
      }),
    )
    expect(screen.getByText('An activity was recorded')).toBeInTheDocument()
  })

  it('renders fallback for invalid data kind', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_CREATED',
        data: { kind: 'invalid' } as never,
      }),
    )
    expect(screen.getByText('An activity was recorded')).toBeInTheDocument()
  })

  it('renders fallback when actorName is null using unknownActor', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_CREATED',
        data: { kind: 'expense', title: 'Dinner' },
        actorName: null,
      }),
    )
    expect(
      screen.getByText(/Someone created expense Dinner/),
    ).toBeInTheDocument()
  })

  it('does not crash for unknown activity type with valid data', () => {
    renderItem(
      makeActivity({
        type: 'UNKNOWN_TYPE' as Activity['type'],
        data: { kind: 'expense', title: 'Test' },
      }),
    )
    expect(screen.getByText('An activity was recorded')).toBeInTheDocument()
  })

  describe('items diff rendering', () => {
    it('renders modified items with before → after on the same line', () => {
      renderItem(
        makeActivity({
          type: 'EXPENSE_UPDATED',
          data: {
            kind: 'expense',
            title: 'Dinner',
            changes: [
              {
                field: 'items',
                before:
                  'Beer 2 × EUR 10.00 = EUR 20.00 → Radler 2 × EUR 9.00 = EUR 18.00',
                after: null,
              },
            ],
          },
        }),
      )
      const change = screen.getByTestId('activity-item-act-1-change-items')
      expect(change.textContent).toContain('Beer 2 × EUR 10.00 = EUR 20.00')
      expect(change.textContent).toContain('Radler 2 × EUR 9.00 = EUR 18.00')
      expect(change.textContent).toContain(' → ')
    })

    it('renders added items with "+" prefix and applies emphasis styling', () => {
      renderItem(
        makeActivity({
          type: 'EXPENSE_UPDATED',
          data: {
            kind: 'expense',
            title: 'Dinner',
            changes: [
              {
                field: 'items',
                before: '+ Tip 1 × EUR 10.00 = EUR 10.00',
                after: null,
              },
            ],
          },
        }),
      )
      const change = screen.getByTestId('activity-item-act-1-change-items')
      // Prefix is stripped from display; only the content remains.
      expect(change.textContent).toContain('Tip 1 × EUR 10.00 = EUR 10.00')
      expect(change.textContent).not.toContain('+ Tip')
    })

    it('renders removed items with "-" prefix and applies strikethrough', () => {
      renderItem(
        makeActivity({
          type: 'EXPENSE_UPDATED',
          data: {
            kind: 'expense',
            title: 'Dinner',
            changes: [
              {
                field: 'items',
                before: '- Water 1 × EUR 5.00 = EUR 5.00',
                after: null,
              },
            ],
          },
        }),
      )
      const change = screen.getByTestId('activity-item-act-1-change-items')
      expect(change.textContent).toContain('Water 1 × EUR 5.00 = EUR 5.00')
      expect(change.textContent).not.toContain('- Water')
      // The removed line should have line-through class.
      const removedLine = change.querySelector('.line-through')
      expect(removedLine).not.toBeNull()
      expect(removedLine!.textContent).toBe('Water 1 × EUR 5.00 = EUR 5.00')
    })

    it('renders mixed modified/added/removed lines independently', () => {
      renderItem(
        makeActivity({
          type: 'EXPENSE_UPDATED',
          data: {
            kind: 'expense',
            title: 'Dinner',
            changes: [
              {
                field: 'items',
                before:
                  'Pizza 2 × EUR 14.00 = EUR 28.00 → Pizza 2 × EUR 15.00 = EUR 30.00\n' +
                  '+ Tip 1 × EUR 10.00 = EUR 10.00\n' +
                  '- Water 1 × EUR 5.00 = EUR 5.00',
                after: null,
              },
            ],
          },
        }),
      )
      const change = screen.getByTestId('activity-item-act-1-change-items')
      // Modified line
      expect(change.textContent).toContain('Pizza 2 × EUR 14.00 = EUR 28.00')
      expect(change.textContent).toContain('Pizza 2 × EUR 15.00 = EUR 30.00')
      // Added line
      expect(change.textContent).toContain('Tip 1 × EUR 10.00 = EUR 10.00')
      // Removed line — same text, but with line-through styling
      expect(change.textContent).toContain('Water 1 × EUR 5.00 = EUR 5.00')
      const removedLine = change.querySelector('.line-through')
      expect(removedLine!.textContent).toBe('Water 1 × EUR 5.00 = EUR 5.00')
    })

    it('does not render the "→" arrow for items changes (after is null)', () => {
      renderItem(
        makeActivity({
          type: 'EXPENSE_UPDATED',
          data: {
            kind: 'expense',
            title: 'Dinner',
            changes: [
              {
                field: 'items',
                before: '+ Tip 1 × EUR 10.00 = EUR 10.00',
                after: null,
              },
            ],
          },
        }),
      )
      const change = screen.getByTestId('activity-item-act-1-change-items')
      // Only the in-content arrow (within modified lines) should appear, not
      // the before→after wrapper arrow used by other differs.
      const arrows = change.querySelectorAll('span')
      const wrapperArrow = Array.from(arrows).find(
        (el) => el.textContent === ' → ',
      )
      expect(wrapperArrow).toBeUndefined()
    })

    it('still renders before → after for non-items fields', () => {
      renderItem(
        makeActivity({
          type: 'EXPENSE_UPDATED',
          data: {
            kind: 'expense',
            title: 'Dinner',
            changes: [
              {
                field: 'items',
                before: '+ Tip 1 × EUR 10.00 = EUR 10.00',
                after: null,
              },
              { field: 'amount', before: 'EUR 12.00', after: 'EUR 15.00' },
            ],
          },
        }),
      )
      const amountChange = screen.getByTestId(
        'activity-item-act-1-change-amount',
      )
      expect(amountChange.textContent).toMatch(/EUR 12\.00.*→.*EUR 15\.00/)
    })
  })
})
