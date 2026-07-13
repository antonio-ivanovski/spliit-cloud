import { ExpenseSplitBars } from '@/app/groups/[groupId]/expenses/expense-split-bars'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

const EUR = {
  code: 'EUR',
  symbol: '€',
  decimal_digits: 2,
  rounding: 0,
}

const rows = [
  {
    id: 'participant-1',
    name: 'Ada',
    amount: 500,
    value: '1/3',
    participant: { id: 'participant-1', name: 'Ada' },
  },
  {
    id: 'participant-2',
    name: 'Grace',
    amount: 300,
    value: '1/3',
    participant: { id: 'participant-2', name: 'Grace' },
  },
  {
    id: 'participant-3',
    name: 'Katherine',
    amount: 200,
    value: '1/3',
    participant: { id: 'participant-3', name: 'Katherine' },
  },
]

describe('ExpenseSplitBars', () => {
  it('places stack avatars over segments and keeps color swatches in the legend', () => {
    render(
      <ExpenseSplitBars
        label="Paid for"
        modeLabel="Evenly"
        rows={rows}
        currency={EUR}
        locale="en-US"
      />,
    )

    const section = screen.getByRole('region', { name: 'Paid for' })
    expect(screen.getByText('Evenly')).toBeInTheDocument()
    const bar = section.querySelector('[aria-hidden="true"].h-4')
    expect(bar).toBeInTheDocument()

    const segments = bar?.querySelectorAll('[class~="@container"]')
    expect(segments).toHaveLength(rows.length)
    expect(segments?.[0]).toHaveStyle({ width: '50%' })
    expect(segments?.[1]).toHaveStyle({ width: '30%' })
    expect(segments?.[2]).toHaveStyle({ width: '20%' })

    const avatarWrappers = bar?.querySelectorAll('[class~="@min-[24px]:flex"]')
    expect(avatarWrappers).toHaveLength(rows.length)
    avatarWrappers?.forEach((wrapper) => {
      expect(wrapper).toHaveClass(
        'hidden',
        'items-center',
        'justify-center',
        'z-10',
      )
      expect(wrapper).toHaveAttribute('aria-hidden', 'true')
      expect(wrapper.querySelector('[class~="size-4"]')).toBeInTheDocument()
    })

    const legend = section.lastElementChild
    expect(legend).toBeInTheDocument()
    expect(legend?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(
      rows.length,
    )
    expect(legend?.querySelectorAll('[class~="size-4"]')).toHaveLength(0)
    rows.forEach((row) => expect(legend).toHaveTextContent(row.name))
    expect(legend).toHaveTextContent('€5.00')
    expect(legend).toHaveTextContent('€3.00')
    expect(legend).toHaveTextContent('€2.00')
    expect(legend).toHaveTextContent('1/3')
  })

  it('keeps avatars hidden by default for segments below the readable width', () => {
    render(
      <ExpenseSplitBars
        label="Paid by"
        rows={[
          { id: 'small', name: 'Small', amount: 1 },
          { id: 'large', name: 'Large', amount: 99 },
        ]}
        currency={EUR}
        locale="en-US"
      />,
    )

    const section = screen.getByRole('region', { name: 'Paid by' })
    const segments = section.querySelectorAll('[class~="@container"]')
    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveStyle({ width: '1%' })
    expect(segments[1]).toHaveStyle({ width: '99%' })

    const smallAvatarWrapper = segments[0].querySelector(
      '[class~="@min-[24px]:flex"]',
    )
    expect(smallAvatarWrapper).toHaveClass('hidden')
  })

  it.each([
    {
      modeLabel: 'By shares',
      values: ['2/5', '3/5'],
      expected: ['2/5', '3/5'],
    },
    {
      modeLabel: 'By percentage',
      values: ['40%', '60%'],
      expected: ['40%', '60%'],
    },
    {
      modeLabel: 'By amount',
      values: [undefined, undefined],
      expected: [],
    },
    {
      modeLabel: 'Itemized',
      values: [undefined, undefined],
      expected: [],
    },
  ])(
    'renders $modeLabel values before amounts',
    ({ modeLabel, values, expected }) => {
      render(
        <ExpenseSplitBars
          label="Paid for"
          modeLabel={modeLabel}
          rows={values.map((value, index) => ({
            id: `participant-${index}`,
            name: `Participant ${index + 1}`,
            amount: (index + 1) * 100,
            value,
          }))}
          currency={EUR}
          locale="en-US"
        />,
      )

      const section = screen.getByRole('region', { name: 'Paid for' })
      expect(screen.getByText(modeLabel)).toBeInTheDocument()
      expected.forEach((value) => expect(section).toHaveTextContent(value))
      if (expected.length === 0) {
        expect(section).not.toHaveTextContent('2/5')
        expect(section).not.toHaveTextContent('40%')
      }
    },
  )

  it('renders a single participant as text only', () => {
    render(
      <ExpenseSplitBars
        label="Paid by"
        rows={[{ id: 'participant-1', name: 'Ada', amount: 1000 }]}
        currency={EUR}
        locale="en-US"
      />,
    )

    const section = screen.getByRole('region', { name: 'Paid by' })
    expect(section.querySelector('[aria-hidden="true"].h-4')).toBeNull()
    expect(section.querySelector('[class~="size-4"]')).toBeNull()
    expect(section.querySelector('[class~="h-2"]')).toBeNull()
    expect(section).toHaveTextContent('Ada')
    expect(section).toHaveTextContent('€10.00')
  })
})
