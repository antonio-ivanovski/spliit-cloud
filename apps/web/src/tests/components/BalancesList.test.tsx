import { render, screen } from '@/test/test-utils'
import { describe, expect, it } from 'vitest'
import { BalancesList } from '@/app/groups/[groupId]/balances-list'

// ── Helpers ──────────────────────────────────────────────────────────────

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }
const USD = { code: 'USD', symbol: '$', decimal_digits: 2, rounding: 0 }

function makeParticipant(id: string, name: string) {
  return { id, name }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('BalancesList', () => {
  it('renders all participants with their balances', () => {
    const participants = [
      makeParticipant('p1', 'Alice'),
      makeParticipant('p2', 'Bob'),
    ]
    const balances = {
      p1: { paid: 3000, paidFor: 1000, total: 2000 },
      p2: { paid: 1000, paidFor: 3000, total: -2000 },
    }

    render(
      <BalancesList
        balances={balances}
        participants={participants}
        currency={USD}
      />,
    )

    expect(screen.getByTestId('balances-list')).toBeInTheDocument()
    expect(screen.getByTestId('balance-row-Alice')).toBeInTheDocument()
    expect(screen.getByTestId('balance-row-Bob')).toBeInTheDocument()
    // Alice has positive balance $20.00
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows positive balances on the left with green bar', () => {
    const participants = [
      makeParticipant('p1', 'Alice'),
      makeParticipant('p2', 'Bob'),
    ]
    const balances = {
      p1: { paid: 3000, paidFor: 1000, total: 2000 },
      p2: { paid: 1000, paidFor: 3000, total: -2000 },
    }

    const { container } = render(
      <BalancesList
        balances={balances}
        participants={participants}
        currency={USD}
      />,
    )

    const aliceRow = screen.getByTestId('balance-row-Alice')
    // Alice has positive balance, so row has flex (not flex-row-reverse)
    expect(aliceRow.className).not.toContain('flex-row-reverse')

    // The green bar should be present for Alice
    const greenBars = container.querySelectorAll('.bg-green-200, .dark\\:bg-green-800')
    expect(greenBars.length).toBeGreaterThanOrEqual(1)

    const redBars = container.querySelectorAll('.bg-red-200, .dark\\:bg-red-800')
    expect(redBars.length).toBeGreaterThanOrEqual(1)
  })

  it('shows negative balances on the right with red bar', () => {
    const participants = [
      makeParticipant('p1', 'Alice'),
      makeParticipant('p2', 'Bob'),
    ]
    const balances = {
      p1: { paid: 3000, paidFor: 1000, total: 2000 },
      p2: { paid: 1000, paidFor: 3000, total: -2000 },
    }

    const { container } = render(
      <BalancesList
        balances={balances}
        participants={participants}
        currency={USD}
      />,
    )

    const bobRow = screen.getByTestId('balance-row-Bob')
    // Bob has negative balance, so row has flex-row-reverse
    expect(bobRow.className).toContain('flex-row-reverse')

    // Red bar should be present for Bob
    const redBars = container.querySelectorAll('.bg-red-200, .dark\\:bg-red-800')
    expect(redBars.length).toBeGreaterThanOrEqual(1)
  })

  it('shows zero balance without colored bar', () => {
    const participants = [makeParticipant('p1', 'Charlie')]
    const balances = {
      p1: { paid: 1000, paidFor: 1000, total: 0 },
    }

    const { container } = render(
      <BalancesList
        balances={balances}
        participants={participants}
        currency={USD}
      />,
    )

    // No colored bars for zero balances
    const greenBars = container.querySelectorAll('.bg-green-200, .dark\\:bg-green-800')
    const redBars = container.querySelectorAll('.bg-red-200, .dark\\:bg-red-800')
    expect(greenBars.length).toBe(0)
    expect(redBars.length).toBe(0)

    // But the name and amount should still be rendered
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('width of bar is proportional to balance magnitude', () => {
    const participants = [
      makeParticipant('p1', 'BigSpender'),
      makeParticipant('p2', 'SmallSpender'),
    ]
    // BigSpender has total 4000, SmallSpender has -1000
    // maxBalance = 4000, so BigSpender gets 100% width, SmallSpender gets 25%
    const balances = {
      p1: { paid: 5000, paidFor: 1000, total: 4000 },
      p2: { paid: 1000, paidFor: 2000, total: -1000 },
    }

    const { container } = render(
      <BalancesList
        balances={balances}
        participants={participants}
        currency={USD}
      />,
    )

    // BigSpender's green bar should have width 100%
    const bars = container.querySelectorAll('[style*="width:"]')
    expect(bars.length).toBe(2)

    // Find the one with 100% width
    const fullWidthBar = Array.from(bars).find(
      (bar) => (bar as HTMLElement).style.width === '100%',
    )
    expect(fullWidthBar).toBeInTheDocument()

    // Find the one with 25% width
    const quarterWidthBar = Array.from(bars).find(
      (bar) => (bar as HTMLElement).style.width === '25%',
    )
    expect(quarterWidthBar).toBeInTheDocument()
  })
})
