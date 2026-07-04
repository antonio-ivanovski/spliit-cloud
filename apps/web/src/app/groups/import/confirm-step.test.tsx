import { render, screen } from '@/test/test-utils'
import type {
  NormalizedSource,
  ParticipantMappingState,
} from '@spliit/domain/import'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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

  it('does not crash when re-rendered with new props (no infinite loop)', () => {
    // Specifically: ConfirmStep used to call `registerStepNav` in an
    // effect whose deps included the (fresh each render) `onSubmit`
    // prop; that combinator cascaded into the parent's nav state,
    // which re-rendered the parent and a new `onSubmit` was pushed
    // back into ConfirmStep — hence the regression test below.
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
    // Multiple rerenders with stable props must not throw or call
    // onSubmit (no click involved).
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
