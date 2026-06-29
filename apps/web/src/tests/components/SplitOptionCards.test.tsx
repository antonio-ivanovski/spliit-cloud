import {
  PaidBySplitOptionCards,
  PaidForSplitOptionCards,
} from '@/app/groups/[groupId]/expenses/expense-form/split-option-cards'
import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

const t = (key: string) => {
  const labels: Record<string, string> = {
    paidBySectionSingle: 'Single',
    paidBySectionMultiple: 'Multiple payers',
    paidByOptionSinglePayer: 'Single payer',
    paidByOptionEvenly: 'Evenly',
    paidByOptionByShares: 'By shares',
    paidByOptionByPercentage: 'By percentage',
    paidByOptionByAmount: 'By amount',
    paidByOptionSinglePayerHelper: 'One person covers the full expense',
    paidByOptionEvenlyHelper: 'Each pays an equal share',
    paidByOptionBySharesHelper: 'Each pays a weighted share',
    paidByOptionByPercentageHelper: 'Each pays a percentage',
    paidByOptionByAmountHelper: 'Each pays a fixed amount',
    paidForSection: 'Split between participants',
    paidForOptionEvenly: 'Evenly',
    paidForOptionByShares: 'By shares',
    paidForOptionByPercentage: 'By percentage',
    paidForOptionByAmount: 'By amount',
    paidForOptionEvenlyHelper: 'Split evenly between everyone',
    paidForOptionBySharesHelper: 'Assign a share to each person',
    paidForOptionByPercentageHelper: 'Assign a percentage to each person',
    paidForOptionByAmountHelper: 'Assign an exact amount to each person',
  }
  return labels[key] ?? key
}

describe('PaidBySplitOptionCards', () => {
  it('renders 5 options across two section labels', () => {
    render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: false, splitMode: 'BY_AMOUNT' }}
        onChange={vi.fn()}
        t={t}
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
        t={t}
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
        t={t}
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
        t={t}
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
        t={t}
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
        t={t}
      />,
    )
    await user.click(screen.getByRole('radio', { name: /by amount/i }))
    expect(onChange).toHaveBeenCalledWith({
      isMultiPayer: true,
      splitMode: 'BY_AMOUNT',
    })
  })

  it('selected option has aria-checked="true" and data-state="checked"', () => {
    render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: true, splitMode: 'BY_PERCENTAGE' }}
        onChange={vi.fn()}
        t={t}
      />,
    )
    const selected = screen.getByRole('radio', { name: /by percentage/i })
    expect(selected).toHaveAttribute('aria-checked', 'true')
    expect(selected).toHaveAttribute('data-state', 'checked')
    expect(
      screen.getByRole('radio', { name: /single payer/i }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByRole('radio', { name: /single payer/i }),
    ).toHaveAttribute('data-state', 'unchecked')
  })

  it('disabled when readOnly is true', () => {
    render(
      <PaidBySplitOptionCards
        value={{ isMultiPayer: false, splitMode: 'BY_AMOUNT' }}
        onChange={vi.fn()}
        readOnly
        t={t}
      />,
    )
    screen.getAllByRole('radio').forEach((r) => expect(r).toBeDisabled())
  })
})

describe('PaidForSplitOptionCards', () => {
  it('renders 4 options under a section label', () => {
    render(<PaidForSplitOptionCards value="EVENLY" onChange={vi.fn()} t={t} />)
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
      <PaidForSplitOptionCards value="EVENLY" onChange={onChange} t={t} />,
    )
    await user.click(screen.getByRole('radio', { name: /by amount/i }))
    expect(onChange).toHaveBeenCalledWith('BY_AMOUNT')
  })

  it('selected option is aria-checked="true" with data-state="checked"', () => {
    render(
      <PaidForSplitOptionCards value="BY_SHARES" onChange={vi.fn()} t={t} />,
    )
    const selected = screen.getByRole('radio', { name: /by shares/i })
    expect(selected).toHaveAttribute('aria-checked', 'true')
    expect(selected).toHaveAttribute('data-state', 'checked')
    const notSelected = screen.getByRole('radio', { name: /evenly/i })
    expect(notSelected).toHaveAttribute('aria-checked', 'false')
    expect(notSelected).toHaveAttribute('data-state', 'unchecked')
  })

  it('disabled when readOnly is true', () => {
    render(
      <PaidForSplitOptionCards
        value="EVENLY"
        onChange={vi.fn()}
        readOnly
        t={t}
      />,
    )
    screen.getAllByRole('radio').forEach((r) => expect(r).toBeDisabled())
  })
})
