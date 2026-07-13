import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { VisualSplitConflictBanner } from './visual-split-conflict-banner'

function renderBanner(
  overrides: Partial<
    React.ComponentProps<typeof VisualSplitConflictBanner>
  > = {},
) {
  const onScaleToTotal = vi.fn()
  const props: React.ComponentProps<typeof VisualSplitConflictBanner> = {
    editable: true,
    hasAllocation: true,
    allocationTarget: 100,
    selectedCount: 3,
    resizeConflict: false,
    onScaleToTotal,
    ...overrides,
  }
  return { onScaleToTotal, ...render(<VisualSplitConflictBanner {...props} />) }
}

describe('VisualSplitConflictBanner', () => {
  it('renders nothing when not editable', () => {
    const { container } = renderBanner({ editable: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the unavailable-amount message when target is below selected count', () => {
    renderBanner({ allocationTarget: 1, selectedCount: 3 })
    expect(
      screen.getByText('Enter an expense amount to edit this split.'),
    ).toBeInTheDocument()
  })

  it('hides the unavailable-amount message when target covers selections', () => {
    renderBanner({ allocationTarget: 5, selectedCount: 3 })
    expect(
      screen.queryByText('Enter an expense amount to edit this split.'),
    ).not.toBeInTheDocument()
  })

  it('shows the resize conflict alert with the Scale action', () => {
    renderBanner({ resizeConflict: true })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(
      'The current locked splits do not fit the new total.',
    )
    expect(
      screen.getByRole('button', { name: 'Scale to new total' }),
    ).toBeInTheDocument()
  })

  it('invokes onScaleToTotal when the action button is clicked', async () => {
    const { user, onScaleToTotal } = renderBanner({ resizeConflict: true })
    await user.click(screen.getByRole('button', { name: 'Scale to new total' }))
    expect(onScaleToTotal).toHaveBeenCalledOnce()
  })

  it('hides the resize conflict when there is no allocation to scale', () => {
    renderBanner({ resizeConflict: true, hasAllocation: false })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
