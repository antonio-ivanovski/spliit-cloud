import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { VisualSplitHeader } from './visual-split-header'

function renderHeader(
  overrides: Partial<React.ComponentProps<typeof VisualSplitHeader>> = {},
) {
  const onSelectAll = vi.fn()
  const onResetEqually = vi.fn()
  const props: React.ComponentProps<typeof VisualSplitHeader> = {
    readOnly: false,
    editable: true,
    hasAllocation: true,
    selectedCount: 1,
    participantCount: 3,
    selectAllLabel: 'Select all',
    onSelectAll,
    onResetEqually,
    ...overrides,
  }
  return {
    onSelectAll,
    onResetEqually,
    ...render(<VisualSplitHeader {...props} />),
  }
}

describe('VisualSplitHeader', () => {
  it('always shows the participants label', () => {
    renderHeader()
    expect(screen.getByText('Participants')).toBeInTheDocument()
  })

  it('hides action buttons in read-only mode', () => {
    renderHeader({ readOnly: true, selectedCount: 1, participantCount: 3 })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows Select all only when not all participants are selected', () => {
    renderHeader({ selectedCount: 1, participantCount: 3 })
    expect(
      screen.getByRole('button', { name: 'Select all' }),
    ).toBeInTheDocument()
  })

  it('hides Select all when everyone is selected', () => {
    renderHeader({ selectedCount: 3, participantCount: 3 })
    expect(
      screen.queryByRole('button', { name: 'Select all' }),
    ).not.toBeInTheDocument()
  })

  it('shows Reset equally only when editable and an allocation exists', () => {
    renderHeader({ editable: true, hasAllocation: true })
    expect(
      screen.getByRole('button', { name: 'Reset equally' }),
    ).toBeInTheDocument()
  })

  it('hides Reset equally when not editable', () => {
    renderHeader({ editable: false, hasAllocation: true })
    expect(
      screen.queryByRole('button', { name: 'Reset equally' }),
    ).not.toBeInTheDocument()
  })

  it('hides Reset equally when no allocation exists yet', () => {
    renderHeader({ editable: true, hasAllocation: false })
    expect(
      screen.queryByRole('button', { name: 'Reset equally' }),
    ).not.toBeInTheDocument()
  })

  it('invokes the matching handlers on click', async () => {
    const { user, onSelectAll, onResetEqually } = renderHeader()
    await user.click(screen.getByRole('button', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Reset equally' }))
    expect(onSelectAll).toHaveBeenCalledOnce()
    expect(onResetEqually).toHaveBeenCalledOnce()
  })
})
