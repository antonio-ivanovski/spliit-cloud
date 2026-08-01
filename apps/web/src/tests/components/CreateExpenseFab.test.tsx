import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CreateExpenseFab } from '@/app/groups/create-expense-fab'
import { render, screen, within } from '@/test/test-utils'

const state = vi.hoisted(() => ({
  pathname: '/',
  currentGroup: null as {
    groupId: string
    group: { id: string; archived: boolean }
    currentInvitation: null
  } | null,
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ pathname: state.pathname }),
  useNavigate: () => state.navigate,
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroupOrNull: () => state.currentGroup,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    overview: {
      get: {
        useQuery: () => ({
          data: {
            groups: [
              {
                id: 'group-1',
                name: 'Trip',
                displayName: null,
                archived: false,
                ledger: { currency: '$', currencyCode: 'USD' },
              },
            ],
          },
        }),
      },
    },
    groups: {
      get: {
        useQuery: () => ({ data: undefined, isPending: false, error: null }),
      },
    },
  },
}))

vi.mock('@/app/groups/[groupId]/expenses/ai-expense-preview', () => ({
  AiExpensePreview: () => null,
}))

vi.mock('@/app/groups/[groupId]/expenses/create-from-receipt-button', () => ({
  CreateFromReceiptButton: ({
    open,
    onOpenChange,
    onFlowActiveChange,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onFlowActiveChange: (active: boolean) => void
  }) =>
    open ? (
      <dialog open aria-label="Scan receipt">
        <button
          type="button"
          onClick={() => {
            onOpenChange(false)
            onFlowActiveChange(true)
          }}
        >
          Review receipt
        </button>
        <button type="button" onClick={() => onFlowActiveChange(false)}>
          Close receipt
        </button>
      </dialog>
    ) : null,
  ReceiptScanTrigger: () => null,
}))

vi.mock('@/app/groups/[groupId]/expenses/voice-expense-button', () => ({
  VoiceExpenseButton: ({
    open,
    onOpenChange,
    onFlowActiveChange,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onFlowActiveChange: (active: boolean) => void
  }) => {
    const [review, setReview] = React.useState(false)
    if (!open && !review) return null
    if (review) {
      return (
        <dialog open aria-label="Voice expense review">
          <button
            type="button"
            onClick={() => {
              setReview(false)
              onFlowActiveChange(false)
            }}
          >
            Close voice
          </button>
        </dialog>
      )
    }
    return (
      <dialog open aria-label="Voice expense">
        <button
          type="button"
          onClick={() => {
            onOpenChange(false)
            onFlowActiveChange(true)
            setReview(true)
          }}
        >
          Review voice expense
        </button>
      </dialog>
    )
  },
}))

describe('CreateExpenseFab', () => {
  it('does not render outside a group context', () => {
    render(<CreateExpenseFab enableReceiptExtract enableVoiceExpense />)

    expect(
      screen.queryByTestId('expense-action-control'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open expense actions' }),
    ).not.toBeInTheDocument()
  })

  it('renders the desktop composite and mobile speed dial together', () => {
    state.currentGroup = {
      groupId: 'group-1',
      group: { id: 'group-1', archived: false },
      currentInvitation: null,
    }

    render(<CreateExpenseFab enableReceiptExtract enableVoiceExpense />)

    const control = screen.getByTestId('expense-action-control')
    expect(
      within(control).getByRole('button', { name: 'Add expense' }),
    ).toBeInTheDocument()
    expect(
      within(control).getByRole('button', { name: 'Voice expense' }),
    ).toBeInTheDocument()
    expect(
      within(control).getByRole('button', { name: 'Scan receipt' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open expense actions' }),
    ).toBeInTheDocument()

    state.currentGroup = null
  })

  it('routes a known-group manual action directly to the expense form', async () => {
    state.currentGroup = {
      groupId: 'group-1',
      group: { id: 'group-1', archived: false },
      currentInvitation: null,
    }

    const { user } = render(
      <CreateExpenseFab
        enableReceiptExtract={false}
        enableVoiceExpense={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add expense' }))

    expect(state.navigate).toHaveBeenCalledWith({
      to: '/groups/$groupId/expenses/create',
      params: { groupId: 'group-1' },
    })
    state.currentGroup = null
  })

  it('keeps the action surfaces hidden through capture and review', async () => {
    state.currentGroup = {
      groupId: 'group-1',
      group: { id: 'group-1', archived: false },
      currentInvitation: null,
    }

    const { user } = render(
      <CreateExpenseFab enableReceiptExtract enableVoiceExpense />,
    )

    await user.click(screen.getByRole('button', { name: 'Voice expense' }))
    expect(
      screen.queryByTestId('expense-action-control'),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Review voice expense' }),
    )
    expect(
      screen.queryByTestId('expense-action-control'),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close voice' }))
    expect(screen.getByTestId('expense-action-control')).toBeInTheDocument()

    state.currentGroup = null
  })

  it('hides the action surfaces on group budget routes', () => {
    state.pathname = '/groups/group-1/budgets'
    state.currentGroup = {
      groupId: 'group-1',
      group: { id: 'group-1', archived: false },
      currentInvitation: null,
    }

    render(<CreateExpenseFab enableReceiptExtract enableVoiceExpense />)

    expect(
      screen.queryByTestId('expense-action-control'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open expense actions' }),
    ).not.toBeInTheDocument()

    state.pathname = '/'
    state.currentGroup = null
  })
})
