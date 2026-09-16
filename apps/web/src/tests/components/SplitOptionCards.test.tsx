import { describe, expect, it, vi } from 'vitest'

import {
  PaidBySplitOptionCards,
  PaidForSplitOptionCards,
} from '@/app/groups/[groupId]/expenses/expense-form/split-option-cards'
import { render, screen } from '@/test/test-utils'

describe('PaidBySplitOptionCards', () => {
  it('renders 5 options across two section labels', () => {
    render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: false, splitMode: 'BY_AMOUNT' }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Single')).toBeInTheDocument()
    expect(screen.getByText('Multiple payers')).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /single payer/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /evenly/i })).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /by shares/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /by percentage/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /by amount/i }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(5)
  })

  it('when Single payer is clicked, onChange is called with { isMultiPayer: false, splitMode: BY_AMOUNT }', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: true, splitMode: 'EVENLY' }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('radio', { name: /single payer/i }))
    expect(onChange).toHaveBeenCalledWith({
      isMultiPayer: false,
      splitMode: 'BY_AMOUNT',
    })
  })

  it('when Evenly is clicked, onChange is called with { isMultiPayer: true, splitMode: EVENLY }', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: false, splitMode: 'BY_AMOUNT' }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('radio', { name: /evenly/i }))
    expect(onChange).toHaveBeenCalledWith({
      isMultiPayer: true,
      splitMode: 'EVENLY',
    })
  })

  it('when by shares is clicked, onChange is called with { isMultiPayer: true, splitMode: BY_SHARES }', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: false, splitMode: 'BY_AMOUNT' }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('radio', { name: /by shares/i }))
    expect(onChange).toHaveBeenCalledWith({
      isMultiPayer: true,
      splitMode: 'BY_SHARES',
    })
  })

  it('when by percentage is clicked, onChange is called with { isMultiPayer: true, splitMode: BY_PERCENTAGE }', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: false, splitMode: 'BY_AMOUNT' }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('radio', { name: /by percentage/i }))
    expect(onChange).toHaveBeenCalledWith({
      isMultiPayer: true,
      splitMode: 'BY_PERCENTAGE',
    })
  })

  it('when by amount is clicked, onChange is called with { isMultiPayer: true, splitMode: BY_AMOUNT }', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: false, splitMode: 'BY_AMOUNT' }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('radio', { name: /by amount/i }))
    expect(onChange).toHaveBeenCalledWith({
      isMultiPayer: true,
      splitMode: 'BY_AMOUNT',
    })
  })

  it('selected option has aria-checked="true" and data-checked', () => {
    render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: true, splitMode: 'BY_PERCENTAGE' }}
        onChange={vi.fn()}
      />,
    )
    const selected = screen.getByRole('radio', { name: /by percentage/i })
    expect(selected).toHaveAttribute('aria-checked', 'true')
    expect(selected).toHaveAttribute('data-checked')
    expect(
      screen.getByRole('radio', { name: /single payer/i }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByRole('radio', { name: /single payer/i }),
    ).toHaveAttribute('data-unchecked')
  })

  it('disabled when readOnly is true', () => {
    render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: false, splitMode: 'BY_AMOUNT' }}
        onChange={vi.fn()}
        readOnly
      />,
    )
    screen
      .getAllByRole('radio')
      .forEach((r) => expect(r).toHaveAttribute('aria-disabled', 'true'))
  })

  it('can hide only multi-payer by amount while keeping Single payer visible', () => {
    render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: false, splitMode: 'BY_AMOUNT' }}
        onChange={vi.fn()}
        hiddenOptionIds={['multi-amount']}
      />,
    )

    expect(
      screen.getByRole('radio', { name: /single payer/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('radio', { name: /by amount/i }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it('renders selected option content and moves it when the mode changes', async () => {
    const onChange = vi.fn()
    const { user, rerender } = render(
      <PaidForSplitOptionCards
        value="EVENLY"
        onChange={onChange}
        renderContent={(mode) => (
          <div data-testid="selected-content">Editor for {mode}</div>
        )}
      />,
    )

    expect(screen.getByTestId('selected-content')).toHaveTextContent(
      'Editor for EVENLY',
    )
    await user.click(screen.getByRole('radio', { name: /by amount/i }))
    expect(onChange).toHaveBeenCalledWith('BY_AMOUNT')

    rerender(
      <PaidForSplitOptionCards
        value="BY_AMOUNT"
        onChange={onChange}
        renderContent={(mode) => (
          <div data-testid="selected-content">Editor for {mode}</div>
        )}
      />,
    )
    expect(screen.getByTestId('selected-content')).toHaveTextContent(
      'Editor for BY_AMOUNT',
    )
  })
})

describe('PaidForSplitOptionCards', () => {
  it('renders 4 options under a section label', () => {
    render(<PaidForSplitOptionCards value="EVENLY" onChange={vi.fn()} />)
    expect(screen.getByText('Split between participants')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /evenly/i })).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /by shares/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /by percentage/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /by amount/i }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it('when clicked, calls onChange with the new SplitMode', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <PaidForSplitOptionCards value="EVENLY" onChange={onChange} />,
    )
    await user.click(screen.getByRole('radio', { name: /by amount/i }))
    expect(onChange).toHaveBeenCalledWith('BY_AMOUNT')
  })

  it('selected option is aria-checked="true" with data-checked', () => {
    render(<PaidForSplitOptionCards value="BY_SHARES" onChange={vi.fn()} />)
    const selected = screen.getByRole('radio', { name: /by shares/i })
    expect(selected).toHaveAttribute('aria-checked', 'true')
    expect(selected).toHaveAttribute('data-checked')
    expect(selected).toHaveClass('cursor-pointer')
    const notSelected = screen.getByRole('radio', { name: /evenly/i })
    expect(notSelected).toHaveAttribute('aria-checked', 'false')
    expect(notSelected).toHaveAttribute('data-unchecked')
    expect(notSelected).toHaveClass('cursor-pointer')
  })

  it('disabled when readOnly is true', () => {
    render(
      <PaidForSplitOptionCards value="EVENLY" onChange={vi.fn()} readOnly />,
    )
    screen
      .getAllByRole('radio')
      .forEach((r) => expect(r).toHaveAttribute('aria-disabled', 'true'))
  })

  it('omits modes listed in hiddenModes', () => {
    render(
      <PaidForSplitOptionCards
        value="EVENLY"
        onChange={vi.fn()}
        hiddenModes={['BY_AMOUNT']}
      />,
    )
    expect(screen.queryByRole('radio', { name: /by amount/i })).toBeNull()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: /evenly/i })).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /by shares/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /by percentage/i }),
    ).toBeInTheDocument()
  })

  it('clears selection when the current value is hidden', () => {
    render(
      <PaidForSplitOptionCards
        value="BY_AMOUNT"
        onChange={vi.fn()}
        hiddenModes={['BY_AMOUNT']}
      />,
    )
    screen
      .getAllByRole('radio')
      .forEach((radio) =>
        expect(radio).toHaveAttribute('aria-checked', 'false'),
      )
  })
})

describe('PaidForSplitOptionCards — proportional option', () => {
  it('is absent by default', () => {
    render(<PaidForSplitOptionCards value="EVENLY" onChange={vi.fn()} />)
    expect(
      screen.queryByRole('radio', { name: /proportional to items/i }),
    ).toBeNull()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it('renders directly below Equal when enabled', () => {
    render(
      <PaidForSplitOptionCards
        value="EVENLY"
        onChange={vi.fn()}
        showProportionalOption
      />,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(5)
    expect(radios[0]).toHaveAccessibleName(/evenly/i)
    expect(radios[1]).toHaveAccessibleName(/proportional to items/i)
    expect(
      screen.getByText(
        /split this amount based on each person's item subtotal/i,
      ),
    ).toBeInTheDocument()
  })

  it('routes selection to onProportionalSelect instead of onChange', async () => {
    const onChange = vi.fn()
    const onProportionalSelect = vi.fn()
    const { user } = render(
      <PaidForSplitOptionCards
        value="EVENLY"
        onChange={onChange}
        showProportionalOption
        onProportionalSelect={onProportionalSelect}
      />,
    )
    await user.click(
      screen.getByRole('radio', { name: /proportional to items/i }),
    )
    expect(onProportionalSelect).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('checks the proportional card and shows its content when selected', () => {
    const { rerender } = render(
      <PaidForSplitOptionCards
        value="EVENLY"
        onChange={vi.fn()}
        showProportionalOption
        proportionalContent={<div data-testid="prop-content">Preview</div>}
      />,
    )
    expect(
      screen.getByRole('radio', { name: /proportional to items/i }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('prop-content')).toBeNull()

    rerender(
      <PaidForSplitOptionCards
        value="EVENLY"
        onChange={vi.fn()}
        showProportionalOption
        proportionalSelected
        proportionalContent={<div data-testid="prop-content">Preview</div>}
      />,
    )
    expect(
      screen.getByRole('radio', { name: /proportional to items/i }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /evenly/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByTestId('prop-content')).toHaveTextContent('Preview')
  })

  it('is hidden when Equal is hidden', () => {
    render(
      <PaidForSplitOptionCards
        value="BY_SHARES"
        onChange={vi.fn()}
        hiddenModes={['EVENLY']}
        showProportionalOption
      />,
    )
    expect(
      screen.queryByRole('radio', { name: /proportional to items/i }),
    ).toBeNull()
  })
})
