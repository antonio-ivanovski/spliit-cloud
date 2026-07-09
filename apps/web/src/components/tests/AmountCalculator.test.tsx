import { AmountCalculatorDialog } from '@/app/groups/[groupId]/expenses/expense-form/amount-calculator-dialog'
import { fireEvent, render, screen } from '@/test/test-utils'
import type { Currency } from '@spliit/domain'
import { useState, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const currency: Currency = {
  code: 'USD',
  symbol: '$',
  rounding: 0,
  decimal_digits: 2,
}

function mockMediaQuery(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

type DialogProps = Omit<
  ComponentProps<typeof AmountCalculatorDialog>,
  'expression' | 'onExpressionChange'
>

function CalculatorHarness({
  initialExpression = '',
  onExpressionChange,
  ...props
}: DialogProps & {
  initialExpression?: string
  onExpressionChange?: (expression: string) => void
}) {
  const [expression, setExpression] = useState(initialExpression)

  return (
    <AmountCalculatorDialog
      {...props}
      expression={expression}
      onExpressionChange={(nextExpression) => {
        setExpression(nextExpression)
        onExpressionChange?.(nextExpression)
      }}
    />
  )
}

function ReopenableCalculatorHarness() {
  const [open, setOpen] = useState(true)
  const [expression, setExpression] = useState('2+4+10')

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen calculator
      </button>
      <AmountCalculatorDialog
        currency={currency}
        expression={expression}
        hasExistingItems={false}
        open={open}
        onExpressionChange={setExpression}
        onOpenChange={setOpen}
        onTransferAmount={vi.fn()}
        onTransferItems={vi.fn()}
      />
    </>
  )
}

function renderCalculator(
  props?: Partial<DialogProps> & { initialExpression?: string },
) {
  const onOpenChange = vi.fn()
  const onTransferAmount = vi.fn()
  const onTransferItems = vi.fn()
  const result = render(
    <CalculatorHarness
      currency={currency}
      hasExistingItems={false}
      initialExpression=""
      open
      onOpenChange={onOpenChange}
      onTransferAmount={onTransferAmount}
      onTransferItems={onTransferItems}
      {...props}
    />,
  )

  return { ...result, onOpenChange, onTransferAmount, onTransferItems }
}

describe('AmountCalculatorDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders as a dialog on desktop and a drawer on mobile', () => {
    mockMediaQuery(true)
    const { unmount } = renderCalculator()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Calculator' }).parentElement,
    ).toHaveClass('sr-only')
    unmount()

    mockMediaQuery(false)
    renderCalculator()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('transfers an evaluated amount', async () => {
    mockMediaQuery(true)
    const { user, onOpenChange, onTransferAmount } = renderCalculator()

    await user.click(screen.getByRole('button', { name: '3' }))
    await user.click(screen.getByRole('button', { name: 'Multiply' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    await user.click(screen.getByRole('button', { name: 'Equals' }))

    expect(onTransferAmount).toHaveBeenCalledWith('36')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not allow an incomplete expression to be transferred', async () => {
    mockMediaQuery(true)
    const { user, onTransferAmount } = renderCalculator()

    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: 'Plus' }))

    expect(screen.getByRole('button', { name: 'Equals' })).toBeDisabled()
    expect(onTransferAmount).not.toHaveBeenCalled()
  })

  it('transfers a valid result when the dialog closes', async () => {
    mockMediaQuery(true)
    const { user, onOpenChange, onTransferAmount } = renderCalculator()

    await user.click(screen.getByRole('button', { name: '3' }))
    await user.keyboard('{Escape}')

    expect(onTransferAmount).toHaveBeenCalledWith('3')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('hides the desktop close control', () => {
    mockMediaQuery(true)
    renderCalculator()

    expect(screen.getByRole('dialog')).toHaveClass('sm:*:last:hidden')
  })

  it('offers a transfer to expense items for an itemizable expression', async () => {
    mockMediaQuery(true)
    const { onOpenChange, onTransferAmount, onTransferItems, user } =
      renderCalculator({
        initialExpression: '3*12+2*5',
      })

    const button = await screen.findByRole('button', {
      name: /create 2 expense items/i,
    })
    await user.click(button)

    expect(onTransferItems).toHaveBeenCalledWith([
      { quantity: 3, unitPrice: 12 },
      { quantity: 2, unitPrice: 5 },
    ])
    expect(onTransferAmount).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('pre-fills the expression from the amount field', () => {
    mockMediaQuery(true)
    renderCalculator({ initialExpression: '12.50' })

    expect(screen.getByTestId('calculator-expression')).toHaveTextContent(
      '12.50',
    )
  })

  it('keeps the expression when reopened', async () => {
    mockMediaQuery(true)
    const { user } = render(<ReopenableCalculatorHarness />)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Reopen calculator' }))

    expect(screen.getByTestId('calculator-expression')).toHaveTextContent(
      '2+4+10',
    )
  })

  it('fills the mobile drawer width', () => {
    mockMediaQuery(false)
    renderCalculator()

    expect(screen.getByRole('dialog')).toHaveClass('max-w-none')
    expect(screen.getByRole('dialog')).not.toHaveClass('max-w-sm')
  })

  it('replaces a prefilled zero when entering a digit', async () => {
    mockMediaQuery(true)
    const { user } = renderCalculator({ initialExpression: '0' })

    await user.click(screen.getByRole('button', { name: '8' }))

    expect(screen.getByTestId('calculator-expression')).toHaveTextContent('8')
  })

  it('accepts keyboard input on desktop', () => {
    mockMediaQuery(true)
    renderCalculator()

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(window, { key: '+' })
    fireEvent.keyDown(window, { key: '3' })

    expect(screen.getByTestId('calculator-expression')).toHaveTextContent(
      '12+3',
    )
  })

  it('keeps item transfer visible but disabled for unsupported expressions', () => {
    mockMediaQuery(true)
    renderCalculator({ initialExpression: '10-2' })

    expect(
      screen.getByRole('button', { name: /create expense items/i }),
    ).toBeDisabled()
    expect(screen.getByText('Use +, ×, and brackets only')).toBeInTheDocument()
  })

  it('treats zero as an empty item-transfer state', () => {
    mockMediaQuery(true)
    renderCalculator({ initialExpression: '0' })

    expect(
      screen.getByRole('button', { name: /create expense items/i }),
    ).toBeDisabled()
    expect(screen.getByText('Enter a calculation')).toBeInTheDocument()
  })

  it('uses a replace action when expense items already exist', () => {
    mockMediaQuery(true)
    renderCalculator({ initialExpression: '3*12', hasExistingItems: true })

    expect(
      screen.getByRole('button', { name: /replace expense items/i }),
    ).toBeEnabled()
  })

  it('replaces an operator with the next operator', async () => {
    mockMediaQuery(true)
    const { user } = renderCalculator()

    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '0' }))
    await user.click(screen.getByRole('button', { name: 'Plus' }))
    await user.click(screen.getByRole('button', { name: 'Minus' }))

    expect(screen.getByTestId('calculator-expression')).toHaveTextContent('10-')
  })
})
