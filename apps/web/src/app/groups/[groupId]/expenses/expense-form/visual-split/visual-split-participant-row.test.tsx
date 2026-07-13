import { getCurrency } from '@/lib/currency'
import { render, screen } from '@/test/test-utils'
import type { SplitMode } from '@spliit/domain'
import { describe, expect, it, vi } from 'vitest'
import type { AllocationEntry } from '../allocation-engine'
import type { VisualSplitParticipant, VisualSplitRow } from './types'
import { VisualSplitParticipantRow } from './visual-split-participant-row'

const usd = getCurrency('USD')!
const participant: VisualSplitParticipant = { id: 'alice', name: 'Alice' }

function renderRow(
  overrides: Partial<
    React.ComponentProps<typeof VisualSplitParticipantRow>
  > = {},
) {
  const onToggle = vi.fn()
  const onSetInputValue = vi.fn()
  const onCommitParticipantValue = vi.fn()
  const onClearInput = vi.fn()
  const onParticipantSharesChange = vi.fn()
  const props: React.ComponentProps<typeof VisualSplitParticipantRow> = {
    participant,
    mode: 'BY_PERCENTAGE' as SplitMode,
    currency: usd,
    readOnly: false,
    editable: true,
    checked: true,
    isOnlySelected: false,
    value: 5000,
    preview: null,
    entry: { id: 'alice', value: 5000, locked: false } as AllocationEntry,
    onToggle,
    onSetInputValue,
    onCommitParticipantValue,
    onClearInput,
    onParticipantSharesChange,
    ...overrides,
  }
  const utils = render(<VisualSplitParticipantRow {...props} />)
  return {
    onToggle,
    onSetInputValue,
    onCommitParticipantValue,
    onClearInput,
    onParticipantSharesChange,
    ...utils,
  }
}

describe('VisualSplitParticipantRow', () => {
  it('renders the participant name, checkbox, and exact input', () => {
    renderRow()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Alice' })).toBeChecked()
    expect(
      screen.getByRole('textbox', { name: "Set Alice's percentage" }),
    ).toHaveValue('50')
  })

  it('emits onToggle when the checkbox changes', async () => {
    const { user, onToggle } = renderRow({ checked: false })
    await user.click(screen.getByRole('checkbox', { name: 'Alice' }))
    expect(onToggle).toHaveBeenCalledWith('alice', true)
  })

  it('keeps the checkbox disabled when read-only', () => {
    renderRow({ readOnly: true })
    expect(screen.getByRole('checkbox', { name: 'Alice' })).toBeDisabled()
  })

  it('disables checkbox and click toggle when this is the only selection', () => {
    renderRow({ isOnlySelected: true })
    expect(screen.getByRole('checkbox', { name: 'Alice' })).toBeDisabled()
  })

  it('commits a percentage value on Enter', async () => {
    const { user, onCommitParticipantValue } = renderRow()
    const input = screen.getByRole('textbox', {
      name: "Set Alice's percentage",
    })
    await user.clear(input)
    await user.type(input, '30{Enter}')
    expect(onCommitParticipantValue).toHaveBeenCalledWith('alice')
  })

  it('clears the input on Escape via onClearInput', async () => {
    const { user, onClearInput } = renderRow()
    const input = screen.getByRole('textbox', {
      name: "Set Alice's percentage",
    })
    await user.click(input)
    await user.keyboard('{Escape}')
    expect(onClearInput).toHaveBeenCalledWith('alice')
  })

  it('shows an error message under the row when present', () => {
    renderRow({ inputError: 'Enter a value from 0.01% to 99.99%.' })
    expect(
      screen.getByText('Enter a value from 0.01% to 99.99%.'),
    ).toBeInTheDocument()
  })

  it('renders BY_SHARES +/- steppers and forwards absolute changes', async () => {
    const row: VisualSplitRow = { participant: 'alice', shares: 3 }
    const { user, onParticipantSharesChange } = renderRow({
      mode: 'BY_SHARES',
      row,
      entry: undefined,
    })
    await user.click(
      screen.getByRole('button', { name: "Increase Alice's shares" }),
    )
    await user.click(
      screen.getByRole('button', { name: "Decrease Alice's shares" }),
    )
    expect(onParticipantSharesChange).toHaveBeenNthCalledWith(1, 'alice', 4)
    expect(onParticipantSharesChange).toHaveBeenNthCalledWith(2, 'alice', 2)
  })

  it('clamps decrements at 1 share', async () => {
    const row: VisualSplitRow = { participant: 'alice', shares: 2 }
    const { user, onParticipantSharesChange } = renderRow({
      mode: 'BY_SHARES',
      row,
      entry: undefined,
    })
    await user.click(
      screen.getByRole('button', { name: "Decrease Alice's shares" }),
    )
    expect(onParticipantSharesChange).toHaveBeenCalledWith('alice', 1)
  })

  it('shows the EV enum preview next to the name for EVENLY mode', () => {
    const { container } = renderRow({
      mode: 'EVENLY',
      preview: <span>10.00</span>,
      entry: undefined,
      checked: true,
    })
    expect(container).toHaveTextContent('10.00')
  })
})
