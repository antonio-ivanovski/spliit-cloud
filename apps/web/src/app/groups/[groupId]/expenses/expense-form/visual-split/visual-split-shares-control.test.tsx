import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { VisualSplitSharesControl } from './visual-split-shares-control'

function renderControl(
  overrides: Partial<
    React.ComponentProps<typeof VisualSplitSharesControl>
  > = {},
) {
  const onShareTargetInputChange = vi.fn()
  const onShareTargetInputFocus = vi.fn()
  const onShareTargetInputBlur = vi.fn()
  const onShareTargetInputKeyDown = vi.fn()
  const onPresetClick = vi.fn()
  const props: React.ComponentProps<typeof VisualSplitSharesControl> = {
    readOnly: false,
    selectedCount: 3,
    shareTotal: 5,
    shareTargetInput: '5',
    onShareTargetInputChange,
    onShareTargetInputFocus,
    onShareTargetInputBlur,
    onShareTargetInputKeyDown,
    onPresetClick,
    ...overrides,
  }
  const utils = render(<VisualSplitSharesControl {...props} />)
  return {
    onShareTargetInputChange,
    onShareTargetInputFocus,
    onShareTargetInputBlur,
    onShareTargetInputKeyDown,
    onPresetClick,
    ...utils,
  }
}

describe('VisualSplitSharesControl', () => {
  it('shows the shares label and all preset buttons', () => {
    renderControl()
    expect(screen.getByText('shares')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '10' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '20' })).toBeInTheDocument()
  })

  it('marks the active preset as aria-pressed', () => {
    renderControl({ shareTotal: 10 })
    expect(screen.getByRole('button', { name: '10' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: '5' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('disables presets below the selected participant count', () => {
    renderControl({ selectedCount: 6, shareTotal: 20 })
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '10' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '20' })).not.toBeDisabled()
  })

  it('disables the custom total when read-only', () => {
    renderControl({ readOnly: true })
    expect(screen.getByLabelText('shares total')).toBeDisabled()
  })

  it('invokes the preset handler with the clicked value', async () => {
    const { user, onPresetClick } = renderControl()
    await user.click(screen.getByRole('button', { name: '20' }))
    expect(onPresetClick).toHaveBeenCalledWith(20)
  })

  it('invokes the input change/blur/keydown handlers', async () => {
    const {
      user,
      onShareTargetInputChange,
      onShareTargetInputFocus,
      onShareTargetInputBlur,
      onShareTargetInputKeyDown,
    } = renderControl({ shareTargetInput: '7' })
    const input = screen.getByLabelText('shares total')
    await user.click(input)
    expect(onShareTargetInputFocus).toHaveBeenCalledOnce()
    await user.keyboard('9')
    expect(onShareTargetInputChange).toHaveBeenCalled()
    await user.tab()
    expect(onShareTargetInputBlur).toHaveBeenCalledOnce()
    await user.click(input)
    await user.keyboard('{Enter}')
    expect(onShareTargetInputKeyDown).toHaveBeenCalled()
  })
})
