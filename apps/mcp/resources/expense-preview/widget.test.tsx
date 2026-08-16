// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExpensePreviewMetadata, ExpensePreviewProps } from './types'

const state = vi.hoisted(() => ({
  view: {
    status: 'ready' as 'pending' | 'ready' | 'error',
    toolOutput: {} as ExpensePreviewProps | undefined,
    meta: {} as ExpensePreviewMetadata | undefined,
    error: undefined as Error | undefined,
  },
  openExternal: vi.fn(),
  tool: {
    callTool: vi.fn(),
    isPending: false,
    error: undefined as Error | undefined,
  },
}))

vi.mock('mcp-use/react', () => ({
  getPublicBaseUrl: () => 'https://spliit.example/mcp/_mcp-use/public/',
  useToolContext: () => state.view,
  useOpenExternal: () => state.openExternal,
  useCallTool: () => state.tool,
}))

import { ExpensePreview } from './widget'

const props: ExpensePreviewProps = {
  preview: {
    group: {
      id: 'group-1',
      name: 'Summer trip',
      currency: '$',
      currencyCode: 'USD',
      decimalDigits: 2,
    },
    expenseCurrency: {
      code: 'USD',
      symbol: '$',
      decimalDigits: 2,
    },
    title: 'Dinner',
    amountMinor: 4250,
    amount: '42.50',
    date: '2026-07-28',
    category: 'Dining Out',
    notes: 'Terrace',
    paidBy: [
      { participantId: 'alice', name: 'Alice', shares: 2250 },
      { participantId: 'bob', name: 'Bob', shares: 2000 },
    ],
    split: {
      mode: 'BY_PERCENTAGE',
      participants: [
        { participantId: 'alice', name: 'Alice', shares: 2500 },
        { participantId: 'bob', name: 'Bob', shares: 7500 },
      ],
    },
    items: [],
    remainder: null,
    conversion: null,
    defaults: [
      { field: 'date', label: 'Date', value: 'Today' },
      { field: 'category', label: 'Category', value: 'General' },
    ],
  },
  expenseUrlBase: 'https://spliit.example/groups/group-1/expenses',
}
const metadata: ExpensePreviewMetadata = {
  confirmationToken: 'encrypted-widget-only-token',
}

describe('ExpensePreview', () => {
  afterEach(cleanup)

  beforeEach(() => {
    state.view.status = 'ready'
    state.view.toolOutput = props
    state.view.meta = metadata
    state.view.error = undefined
    state.openExternal.mockReset()
    state.tool.callTool.mockReset()
    state.tool.isPending = false
    state.tool.error = undefined
  })

  it('renders an accessible, non-editable narrow-friendly preview', () => {
    render(<ExpensePreview />)
    expect(
      screen.getByRole('main', { name: 'Expense preview' }),
    ).toBeInTheDocument()
    expect(screen.getByText('$42.50')).toBeInTheDocument()
    expect(screen.getByText('$22.50')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('Terrace')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Spliit logo' })).toBeInTheDocument()
    expect(screen.getByText('Defaults applied')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(
      screen.queryByText(metadata.confirmationToken),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create expense' })).toBeEnabled()
  })

  it('sends only the confirmation token and transitions to success', async () => {
    state.tool.callTool.mockResolvedValue({
      structuredContent: {
        expenseId: 'expense-1',
        expenseUrl: 'https://spliit.example/groups/group-1/expenses/expense-1',
      },
    })
    const user = userEvent.setup()
    render(<ExpensePreview />)

    await user.click(screen.getByRole('button', { name: 'Create expense' }))

    expect(state.tool.callTool).toHaveBeenCalledWith({
      confirmationToken: metadata.confirmationToken,
    })
    await waitFor(() =>
      expect(screen.getByText('Expense created')).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'Open in Spliit' }))
    expect(state.openExternal).toHaveBeenCalledWith({
      url: 'https://spliit.example/groups/group-1/expenses/expense-1',
    })
  })

  it('shows the entered currency and sealed group-currency conversion', () => {
    state.view.toolOutput = {
      ...props,
      preview: {
        ...props.preview,
        expenseCurrency: {
          code: 'EUR',
          symbol: '€',
          decimalDigits: 2,
        },
        amountMinor: 1500,
        amount: '15',
        conversion: {
          ledgerAmountMinor: 97500,
          ledgerCurrencyCode: 'MKD',
          ledgerCurrencySymbol: 'ден',
          ledgerDecimalDigits: 2,
          rate: 65,
        },
      },
    }
    render(<ExpensePreview />)
    expect(screen.getByText('€15.00')).toBeInTheDocument()
    expect(
      screen.getByText(/MKD\s*975\.00 in group currency/),
    ).toBeInTheDocument()
  })

  it('renders item allocations, remainder and aggregate participant totals', () => {
    state.view.toolOutput = {
      ...props,
      preview: {
        ...props.preview,
        amountMinor: 5600,
        amount: '56',
        split: {
          mode: 'ITEMIZED',
          participants: [
            { participantId: 'alice', name: 'Alice', shares: 1527 },
            { participantId: 'alex', name: 'Alex', shares: 800 },
            { participantId: 'joe', name: 'Joe', shares: 3273 },
          ],
        },
        items: [
          {
            lineId: 'beer-line',
            title: 'Beer',
            unitPriceMinor: 500,
            quantity: 3,
            amountMinor: 1500,
            split: {
              mode: 'BY_SHARES',
              participants: [
                { participantId: 'alice', name: 'Alice', shares: 300 },
                { participantId: 'alex', name: 'Alex', shares: 200 },
              ],
            },
          },
          {
            lineId: 'steak-line',
            title: 'Steak',
            unitPriceMinor: 3000,
            quantity: 1,
            amountMinor: 3000,
            split: {
              mode: 'BY_AMOUNT',
              participants: [
                { participantId: 'joe', name: 'Joe', shares: 3000 },
              ],
            },
          },
        ],
        remainder: {
          amountMinor: 1100,
          split: {
            mode: 'BY_AMOUNT',
            participants: [
              { participantId: 'alice', name: 'Alice', shares: 627 },
              { participantId: 'alex', name: 'Alex', shares: 300 },
              { participantId: 'joe', name: 'Joe', shares: 173 },
            ],
          },
        },
      },
    }

    render(<ExpensePreview />)

    expect(screen.getByText('Items')).toBeInTheDocument()
    expect(screen.getByText('3 × $5.00')).toBeInTheDocument()
    expect(screen.getByText('3 shares')).toBeInTheDocument()
    expect(screen.getByText('2 shares')).toBeInTheDocument()
    expect(screen.getByText('Tax, tip & remainder')).toBeInTheDocument()
    expect(screen.getByText('$32.73')).toBeInTheDocument()
  })

  it('renders BY_SHARES splits as display shares across flat, item, and remainder routes', () => {
    state.view.toolOutput = {
      ...props,
      preview: {
        ...props.preview,
        amountMinor: 4250,
        amount: '42.50',
        split: {
          mode: 'BY_SHARES',
          participants: [
            { participantId: 'alice', name: 'Alice', shares: 50 },
            { participantId: 'bob', name: 'Bob', shares: 150 },
          ],
        },
        items: [
          {
            lineId: 'beer-line',
            title: 'Beer',
            unitPriceMinor: 500,
            quantity: 1,
            amountMinor: 500,
            split: {
              mode: 'BY_SHARES',
              participants: [
                { participantId: 'alice', name: 'Alice', shares: 110 },
                { participantId: 'bob', name: 'Bob', shares: 300 },
              ],
            },
          },
        ],
        remainder: {
          amountMinor: 3750,
          split: {
            mode: 'BY_SHARES',
            participants: [
              { participantId: 'alice', name: 'Alice', shares: 100 },
              { participantId: 'bob', name: 'Bob', shares: 100 },
            ],
          },
        },
      },
    }

    render(<ExpensePreview />)

    // Flat split: stored 50/150 → 0.5 / 1.5 shares.
    expect(screen.getByText('0.5 shares')).toBeInTheDocument()
    expect(screen.getByText('1.5 shares')).toBeInTheDocument()
    // Item split: stored 110/300 → 1.1 / 3 shares.
    expect(screen.getByText('1.1 shares')).toBeInTheDocument()
    expect(screen.getByText('3 shares')).toBeInTheDocument()
    // Remainder split: stored 100/100 → 1 share each (singular, no .00).
    expect(screen.getAllByText('1 share')).toHaveLength(2)
    // No raw fixed units leak into any label.
    expect(screen.queryByText('50 shares')).not.toBeInTheDocument()
    expect(screen.queryByText('110 shares')).not.toBeInTheDocument()
    expect(screen.queryByText('300 shares')).not.toBeInTheDocument()
  })

  it('keeps the preview visible after a retryable failure', () => {
    state.tool.error = new Error('Temporary failure')
    render(<ExpensePreview />)
    expect(screen.getByText('Dinner')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('preview is unchanged')
    expect(screen.getByRole('button', { name: 'Create expense' })).toBeEnabled()
  })

  it('shows an expired-preview recovery message', () => {
    state.tool.error = new Error('Preview expired')
    render(<ExpensePreview />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Ask the assistant for a fresh one',
    )
  })

  it('disables confirmation when widget-only metadata is missing', () => {
    state.view.meta = {} as ExpensePreviewMetadata
    render(<ExpensePreview />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'preview can no longer be confirmed',
    )
    expect(
      screen.getByRole('button', { name: 'Create expense' }),
    ).toBeDisabled()
  })

  it('renders a loading state and disables the action while creating', () => {
    state.view.status = 'pending'
    const { rerender } = render(<ExpensePreview />)
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')

    state.view.status = 'ready'
    state.tool.isPending = true
    rerender(<ExpensePreview />)
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()
  })
})
