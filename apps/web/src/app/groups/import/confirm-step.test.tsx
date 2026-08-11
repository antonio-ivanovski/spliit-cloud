import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'
import type {
  NormalizedSource,
  ParticipantMappingState,
} from '@spliit/domain/import'

import { ConfirmStep } from './confirm-step'

// ── Fixtures ────────────────────────────────────────────────────────────

const source: NormalizedSource = {
  provider: 'SPLIIT',
  sourceGroupId: 'src-1',
  sourceUrl: null,
  name: 'Trip',
  currency: '€',
  currencyCode: 'EUR',
  participants: [{ sourceId: 'a', sourceName: 'Alice' }],
  expenses: [],
}

const participants: ParticipantMappingState[] = [
  {
    key: '0',
    source: { sourceId: 'a', sourceName: 'Alice' },
    mode: 'LINK_ACCOUNT',
    linkedAccountId: 'user-1',
  },
]

const groupFormValues = {
  name: 'Trip',
  information: '',
  currency: '€',
  currencyCode: 'EUR',
}

const REQUIRED_PROPS = {
  source,
  mode: 'NEW_GROUP' as const,
  targetGroupId: null,
  groupFormValues,
  participants,
  resolvedExpenses: [],
  conversionModes: {},
  rates: undefined,
  onBack: vi.fn(),
  onSubmit: vi.fn(),
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ConfirmStep', () => {
  it('hides document counts when the document flow was not visited', () => {
    render(<ConfirmStep {...REQUIRED_PROPS} isSubmitting={false} />)

    expect(screen.queryByText(/documents:/i)).not.toBeInTheDocument()
  })

  it('shows document counts after the document flow was visited', () => {
    render(
      <ConfirmStep
        {...REQUIRED_PROPS}
        isSubmitting={false}
        showDocumentSummary
        recoveredDocumentCount={2}
        skippedDocumentCount={1}
      />,
    )

    expect(
      screen.getByText(/documents: 2 recovered, 1 skipped/i),
    ).toBeInTheDocument()
  })

  it('renders the import action button labelled "Import group" by default', () => {
    render(<ConfirmStep {...REQUIRED_PROPS} isSubmitting={false} />)
    expect(
      screen.getByRole('button', { name: /import group/i }),
    ).toBeInTheDocument()
  })

  it('disables the button and switches the label to "Importing…" when isSubmitting', () => {
    render(<ConfirmStep {...REQUIRED_PROPS} isSubmitting={true} />)
    const btn = screen.getByRole('button', { name: /importing/i })
    expect(btn).toBeDisabled()
    // The default label should be gone.
    expect(
      screen.queryByRole('button', { name: /import group/i }),
    ).not.toBeInTheDocument()
  })

  it('calls onSubmit exactly once when clicked', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <ConfirmStep
        {...REQUIRED_PROPS}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getByRole('button', { name: /import group/i }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('does not call onSubmit when the button is disabled (isSubmitting)', async () => {
    const onSubmit = vi.fn()
    render(
      <ConfirmStep
        {...REQUIRED_PROPS}
        isSubmitting={true}
        onSubmit={onSubmit}
      />,
    )
    const btn = screen.getByRole('button', { name: /importing/i })
    expect(btn).toBeDisabled()
    // userEvent respects `disabled` — clicking does nothing.
    await userEvent.setup().click(btn)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onBack when Back is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <ConfirmStep {...REQUIRED_PROPS} isSubmitting={false} onBack={onBack} />,
    )
    await user.click(screen.getByRole('button', { name: /back to/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('lists unique recurring schedules, not every occurrence', () => {
    const monthly = {
      title: 'Spotify Monthly',
      expenseDate: '2025-05-19',
      category: 'general',
      amountCurrency: 'EUR',
      amount: 1000,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidBySourceId: 'a',
      paidBy: [{ sourceId: 'a', shares: 1000 }],
      paidFor: [{ sourceId: 'a', shares: 1 }],
      splitMode: 'EVENLY' as const,
      recurrenceRule: 'MONTHLY' as const,
      recurrence: {
        frequency: 'MONTHLY' as const,
        interval: 1,
        end: { type: 'INDEFINITE' as const },
      },
      isReimbursement: false,
      notes: null,
    }
    render(
      <ConfirmStep
        {...REQUIRED_PROPS}
        isSubmitting={false}
        resolvedExpenses={[
          monthly,
          { ...monthly, expenseDate: '2025-06-19' },
          { ...monthly, expenseDate: '2025-07-19' },
          {
            ...monthly,
            title: 'Gym',
            recurrenceRule: 'WEEKLY',
            recurrence: {
              frequency: 'WEEKLY',
              interval: 1,
              end: { type: 'INDEFINITE' },
            },
            expenseDate: '2026-07-01',
          },
        ]}
      />,
    )
    expect(
      screen.getByText(/recurring schedules to import/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/Spotify Monthly · Monthly/i)).toBeInTheDocument()
    expect(screen.getByText(/Gym · Weekly/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Spotify Monthly · Monthly/i)).toHaveLength(1)
  })

  it('hides the recurring schedules block when none are present', () => {
    render(<ConfirmStep {...REQUIRED_PROPS} isSubmitting={false} />)
    expect(
      screen.queryByText(/recurring schedules to import/i),
    ).not.toBeInTheDocument()
  })

  it('uses Cloud manifest counts and hides normalized FX/recurrence summaries', () => {
    render(
      <ConfirmStep
        {...REQUIRED_PROPS}
        isSubmitting={false}
        conversionModes={{ 'JPY|EUR': 'perDate' }}
        rates={{ '2026-01-01|JPY|EUR': 0.01 }}
        cloudSummary={{
          archived: false,
          activeRecurrenceCount: 2,
          expenseCount: 7,
        }}
      />,
    )

    expect(screen.getByText(/7 expenses will be created/i)).toBeInTheDocument()
    expect(
      screen.getByText(/2 active recurrence schedule\(s\) will resume/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/applied exchange rates/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/recurring schedules to import/i),
    ).not.toBeInTheDocument()
  })

  it('does not crash when re-rendered with new props (no infinite loop)', () => {
    const onSubmit = vi.fn()
    const onBack = vi.fn()
    const { rerender } = render(
      <ConfirmStep
        {...REQUIRED_PROPS}
        isSubmitting={false}
        onSubmit={onSubmit}
        onBack={onBack}
      />,
    )
    rerender(
      <ConfirmStep
        {...REQUIRED_PROPS}
        isSubmitting={false}
        onSubmit={onSubmit}
        onBack={onBack}
      />,
    )
    rerender(
      <ConfirmStep
        {...REQUIRED_PROPS}
        isSubmitting={false}
        onSubmit={onSubmit}
        onBack={onBack}
      />,
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
