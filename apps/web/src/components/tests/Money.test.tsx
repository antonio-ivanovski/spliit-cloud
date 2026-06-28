import { render, screen } from '@/test/test-utils'
import { Money } from '@/components/money'
import type { Currency } from '@/lib/currency'

const usd: Currency = { code: 'USD', symbol: '$', rounding: 0, decimal_digits: 2 }

describe('Money', () => {
  it('renders formatted currency without bold or color classes by default', () => {
    render(<Money currency={usd} amount={100} />)
    const element = screen.getByText('$1.00')
    expect(element).toBeInTheDocument()
    expect(element).not.toHaveClass('font-bold')
    expect(element).not.toHaveClass('text-green-600')
    expect(element).not.toHaveClass('text-red-600')
  })

  it('renders with bold class when bold prop is true', () => {
    render(<Money currency={usd} amount={100} bold />)
    expect(screen.getByText('$1.00')).toHaveClass('font-bold')
  })

  it('renders with green color for amount greater than 1 cent when colored is true', () => {
    render(<Money currency={usd} amount={200} colored />)
    expect(screen.getByText('$2.00')).toHaveClass('text-green-600')
  })

  it('renders with red color for amount equal to 1 cent when colored is true', () => {
    render(<Money currency={usd} amount={1} colored />)
    expect(screen.getByText('$0.01')).toHaveClass('text-red-600')
  })

  it('renders with red color for amount of 0 cents when colored is true', () => {
    render(<Money currency={usd} amount={0} colored />)
    expect(screen.getByText('$0.00')).toHaveClass('text-red-600')
  })
})
