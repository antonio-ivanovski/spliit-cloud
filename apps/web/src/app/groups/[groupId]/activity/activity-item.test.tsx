import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { Activity } from './activity-item'
import { ActivityItem } from './activity-item'

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
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
    expect(
      screen.getByText(/Alice updated expense Dinner/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Changed:/)).toBeInTheDocument()
    expect(screen.getByText(/amount/)).toBeInTheDocument()
    expect(screen.getByText(/date/)).toBeInTheDocument()
  })

  it('renders expense updated without changed fields', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_UPDATED',
        data: { kind: 'expense', title: 'Lunch' },
      }),
    )
    expect(
      screen.getByText(/Alice updated expense Lunch/),
    ).toBeInTheDocument()
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
    expect(
      screen.getByText(/Alice updated expense Dinner/),
    ).toBeInTheDocument()
    expect(screen.getByText(/EUR 12.00.*EUR 15.00/)).toBeInTheDocument()
    expect(screen.getByText(/Alice.*Alice, Bob/)).toBeInTheDocument()
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
    expect(
      screen.getByText(/Alice updated expense Lunch/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Changed:/)).toBeInTheDocument()
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

  it('renders group updated', () => {
    renderItem(
      makeActivity({
        type: 'GROUP_UPDATED',
        data: { kind: 'group' },
      }),
    )
    expect(
      screen.getByText(/Alice updated group settings/),
    ).toBeInTheDocument()
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

  it('renders fallback for null data', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_CREATED',
        data: null,
      }),
    )
    expect(
      screen.getByText('An activity was recorded'),
    ).toBeInTheDocument()
  })

  it('renders fallback for invalid data kind', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_CREATED',
        data: { kind: 'invalid' } as never,
      }),
    )
    expect(
      screen.getByText('An activity was recorded'),
    ).toBeInTheDocument()
  })

  it('renders fallback when actorName is null using unknownActor', () => {
    renderItem(
      makeActivity({
        type: 'EXPENSE_CREATED',
        data: { kind: 'expense', title: 'Dinner' },
        actorName: null,
      }),
    )
    expect(screen.getByText(/Someone created expense Dinner/)).toBeInTheDocument()
  })

  it('does not crash for unknown activity type with valid data', () => {
    renderItem(
      makeActivity({
        type: 'UNKNOWN_TYPE' as Activity['type'],
        data: { kind: 'expense', title: 'Test' },
      }),
    )
    expect(
      screen.getByText('An activity was recorded'),
    ).toBeInTheDocument()
  })
})
