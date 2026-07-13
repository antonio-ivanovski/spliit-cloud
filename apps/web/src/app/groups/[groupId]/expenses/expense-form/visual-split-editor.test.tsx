import { getCurrency } from '@/lib/currency'
import { render, screen } from '@/test/test-utils'
import type { SplitMode } from '@spliit/domain'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { VisualSplitEditor, type VisualSplitRow } from './visual-split-editor'

const participants = [
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' },
  { id: 'carol', name: 'Carol' },
]
const currency = getCurrency('USD')!

function Harness({
  mode,
  readOnly = false,
  initialRows,
  initialTarget = 90,
}: {
  mode: SplitMode
  readOnly?: boolean
  initialRows?: VisualSplitRow[]
  initialTarget?: number
}) {
  const [rows, setRows] = useState<VisualSplitRow[]>(
    initialRows ??
      participants.map((participant) => ({
        participant: participant.id,
        shares: mode === 'BY_PERCENTAGE' ? 100 / 3 : 1,
      })),
  )
  const [target, setTarget] = useState(initialTarget)
  const [sign, setSign] = useState<1 | -1>(1)
  if (mode === 'ITEMIZED') return null
  return (
    <>
      <button
        type="button"
        onClick={() =>
          setRows([
            { participant: 'alice', shares: 20 },
            { participant: 'bob', shares: 30 },
            { participant: 'carol', shares: 50 },
          ])
        }
      >
        Load saved split
      </button>
      <button type="button" onClick={() => setTarget(50)}>
        Change total
      </button>
      <button type="button" onClick={() => setSign(-1)}>
        Make income
      </button>
      <output aria-label="Current split">{JSON.stringify(rows)}</output>
      <VisualSplitEditor
        mode={mode}
        participants={participants}
        rows={rows}
        targetAmount={target}
        currency={currency}
        amountSign={sign}
        readOnly={readOnly}
        selectAllLabel="Select all"
        onRowsChange={setRows}
        amountPreview={(id, current) =>
          String(current.find((row) => row.participant === id)?.shares ?? '')
        }
      />
    </>
  )
}

describe('VisualSplitEditor', () => {
  it('uses checkable rows and a static rail for even splits', () => {
    render(<Harness mode="EVENLY" />)

    expect(screen.getByTestId('visual-split-evenly')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('keeps participant colors stable when the selected rail is a subset', () => {
    render(
      <Harness
        mode="BY_PERCENTAGE"
        initialRows={[
          { participant: 'bob', shares: 50 },
          { participant: 'carol', shares: 50 },
        ]}
      />,
    )

    expect(screen.getByTitle('Bob: 50%')).toHaveClass('bg-amber-500')
    expect(screen.getByTitle('Carol: 50%')).toHaveClass('bg-emerald-500')
  })

  it('uses increment and decrement controls for share weights', async () => {
    const { user } = render(<Harness mode="BY_SHARES" />)

    await user.click(
      screen.getByRole('button', { name: "Increase Alice's shares" }),
    )
    expect(
      screen.getByRole('spinbutton', { name: 'Alice shares' }),
    ).toHaveValue(2)
    expect(screen.getAllByRole('slider')).toHaveLength(2)
  })

  it('offers total share presets and redistributes the selected participants', async () => {
    const { user } = render(<Harness mode="BY_SHARES" />)

    await user.click(screen.getByRole('button', { name: '5' }))

    expect(screen.getByRole('button', { name: '5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const split = JSON.parse(
      screen.getByLabelText('Current split').textContent ?? '[]',
    ) as VisualSplitRow[]
    expect(split.reduce((sum, row) => sum + row.shares, 0)).toBe(5)
    expect(screen.getByLabelText('shares total')).toHaveValue(5)
  })

  it('accepts a custom total share value', async () => {
    const { user } = render(<Harness mode="BY_SHARES" />)
    const total = screen.getByLabelText('shares total')

    await user.clear(total)
    await user.type(total, '7')
    await user.tab()

    const split = JSON.parse(
      screen.getByLabelText('Current split').textContent ?? '[]',
    ) as VisualSplitRow[]
    expect(split.reduce((sum, row) => sum + row.shares, 0)).toBe(7)
    expect(total).toHaveValue(7)
  })

  it('edits an inline percentage', async () => {
    const { user } = render(<Harness mode="BY_PERCENTAGE" />)
    const input = screen.getByRole('textbox', {
      name: "Set Alice's percentage",
    })
    await user.clear(input)
    await user.type(input, '30')
    await user.tab()
    expect(screen.getByLabelText('Current split')).toHaveTextContent(
      '"shares":30',
    )
    expect(screen.queryByTestId('focused-split-slider')).not.toBeInTheDocument()
  })

  it('removes all editing controls in read-only mode', () => {
    render(<Harness mode="BY_AMOUNT" readOnly />)

    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')[0]).toBeDisabled()
  })

  it('synchronizes a saved split whose participant identities are unchanged', async () => {
    const { user } = render(<Harness mode="BY_PERCENTAGE" />)

    await user.click(screen.getByRole('button', { name: 'Load saved split' }))
    expect(
      screen.getByRole('textbox', { name: "Set Alice's percentage" }),
    ).toHaveValue('20')
    expect(screen.getByLabelText('Current split')).toHaveTextContent(
      '"shares":20',
    )
  })

  it('normalizes externally selected rows and emits the exact allocation', async () => {
    const { user } = render(
      <Harness
        mode="BY_PERCENTAGE"
        initialRows={[{ participant: 'alice', shares: 100 }]}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Bob' }))
    expect(screen.getByLabelText('Current split')).toHaveTextContent(
      '"shares":50',
    )
    expect(screen.getByLabelText('Current split').textContent).toContain(
      '"participant":"bob","shares":50',
    )
  })

  it('selects all through the allocation state', async () => {
    const { user } = render(
      <Harness
        mode="BY_PERCENTAGE"
        initialRows={[
          { participant: 'alice', shares: 50 },
          { participant: 'bob', shares: 50 },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByLabelText('Current split')).toHaveTextContent(
      '"participant":"carol"',
    )
    expect(screen.getByLabelText('Current split')).toHaveTextContent(
      '"participant":"bob"',
    )
    expect(screen.getByLabelText('Current split')).toHaveTextContent(
      '"participant":"alice"',
    )
  })

  it('updates paid-by amount row signs when the magnitude stays the same', async () => {
    const { user } = render(
      <Harness
        mode="BY_AMOUNT"
        initialRows={[
          { participant: 'alice', shares: 30 },
          { participant: 'bob', shares: 30 },
          { participant: 'carol', shares: 30 },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Make income' }))

    expect(screen.getByLabelText('Current split').textContent).toContain(
      '"shares":-30',
    )
    expect(screen.getByLabelText('Current split').textContent).not.toMatch(
      /"shares":30(?:[,}])/,
    )
  })

  it('allows deselecting participants until a tiny amount becomes editable', async () => {
    const { user } = render(<Harness mode="BY_AMOUNT" initialTarget={0.02} />)

    expect(
      screen.getByText('Enter an expense amount to edit this split.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Carol' }))
    expect(
      screen.queryByText('Enter an expense amount to edit this split.'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Carol' })).not.toBeChecked()
  })

  it('keeps invalid exact input open with its permitted range and restores on Escape', async () => {
    const { user } = render(<Harness mode="BY_PERCENTAGE" />)
    const exact = screen.getByRole('textbox', {
      name: "Set Alice's percentage",
    })
    await user.clear(exact)
    await user.type(exact, '101{Enter}')

    expect(exact).toHaveValue('101')
    expect(exact).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Enter a value from 0.01% to/)).toBeInTheDocument()

    await user.type(exact, '{Escape}')
    expect(exact).toHaveValue('')
    expect(
      screen.queryByText(/Enter a value from 0.01% to/),
    ).not.toBeInTheDocument()
  })
})
