import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CurrencySelector } from '@/components/currency-selector'
import type { DisplayCurrency } from '@/lib/currency'
import { useMediaQuery } from '@/lib/hooks'
import { fireEvent, render, screen } from '@/test/test-utils'

vi.mock('@/lib/hooks', () => ({
  useMediaQuery: vi.fn(() => true),
}))

const mediaQueryMock = vi.mocked(useMediaQuery)

const currencies: DisplayCurrency[] = [
  {
    code: 'AUD',
    symbol: 'A$',
    rounding: 0,
    decimal_digits: 2,
    name: 'Australian Dollar',
  },
  {
    code: 'CAD',
    symbol: 'C$',
    rounding: 0,
    decimal_digits: 2,
    name: 'Canadian Dollar',
  },
  {
    code: 'CNY',
    symbol: 'CN¥',
    rounding: 0,
    decimal_digits: 2,
    name: 'Chinese Yuan',
  },
  {
    code: 'EUR',
    symbol: '€',
    rounding: 0,
    decimal_digits: 2,
    name: 'Euro',
  },
  {
    code: 'GBP',
    symbol: '£',
    rounding: 0,
    decimal_digits: 2,
    name: 'British Pound',
  },
  {
    code: 'JPY',
    symbol: '¥',
    rounding: 0,
    decimal_digits: 0,
    name: 'Japanese Yen',
  },
  {
    code: 'USD',
    symbol: '$',
    rounding: 0,
    decimal_digits: 2,
    name: 'US Dollar',
  },
  {
    code: '',
    symbol: 'Custom',
    rounding: 0,
    decimal_digits: 2,
    name: 'Custom',
  },
]

function openSelectorWith(
  props: Partial<React.ComponentProps<typeof CurrencySelector>> = {},
) {
  const onValueChange = vi.fn()
  const result = render(
    <CurrencySelector
      currencies={currencies}
      defaultValue="USD"
      isLoading={false}
      onValueChange={onValueChange}
      {...props}
    />,
  )
  fireEvent.click(screen.getByRole('combobox'))
  return { onValueChange, ...result }
}

// Item codes in DOM order. Items with no 3-letter code (e.g. Custom) are
// surfaced as empty strings; tests assert on those positions separately.
function itemCodesInOrder(): string[] {
  return Array.from(document.querySelectorAll('[cmdk-item]')).map((el) => {
    const match = (el.textContent ?? '').match(/\(([A-Z]{3})\)/)
    return match?.[1] ?? ''
  })
}

function separatorCount(): number {
  return document.querySelectorAll('[cmdk-separator]').length
}

describe('CurrencySelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mediaQueryMock.mockReturnValue(true)
  })

  it('uses a mobile drawer for multi-selects and keeps it open while toggling', () => {
    mediaQueryMock.mockReturnValue(false)
    const onValueToggle = vi.fn()

    render(
      <CurrencySelector
        currencies={currencies}
        defaultValue="USD"
        isLoading={false}
        onValueChange={vi.fn()}
        mode="multi"
        selectedValues={[]}
        onValueToggle={onValueToggle}
        multiPlaceholder="All currencies"
        mobileTitle="Currency"
        mobileDoneLabel="Done"
      />,
    )

    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/US Dollar/))

    expect(onValueToggle).toHaveBeenCalledWith('USD')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('pins the group currency first in the priority block', () => {
    openSelectorWith({
      pinnedCurrencyCode: 'EUR',
      recommendedCurrencyCodes: ['GBP', 'JPY'],
    })

    expect(document.querySelectorAll('[cmdk-group-heading]')).toHaveLength(0)
    const codes = itemCodesInOrder()
    expect(codes[0]).toBe('EUR')
    expect(codes.indexOf('EUR')).toBeLessThan(codes.indexOf('GBP'))
    expect(codes.indexOf('GBP')).toBeLessThan(codes.indexOf('JPY'))
    expect(separatorCount()).toBe(1)
  })

  it('renders recommended currencies in server rank order', () => {
    openSelectorWith({
      pinnedCurrencyCode: 'USD',
      recommendedCurrencyCodes: ['JPY', 'GBP', 'CAD'],
    })

    const codes = itemCodesInOrder()
    expect(codes.slice(0, 4)).toEqual(['USD', 'JPY', 'GBP', 'CAD'])
    expect(separatorCount()).toBe(1)
  })

  it('does not duplicate the group currency in recommendations', () => {
    openSelectorWith({
      pinnedCurrencyCode: 'USD',
      // Server should already exclude USD; client also dedupes.
      recommendedCurrencyCodes: ['USD', 'EUR'],
    })

    const codes = itemCodesInOrder()
    expect(codes.filter((code) => code === 'USD')).toHaveLength(1)
    expect(codes.filter((code) => code === 'EUR')).toHaveLength(1)
    expect(codes.indexOf('USD')).toBeLessThan(codes.indexOf('EUR'))
  })

  it('falls back to static common currencies when recommendations are omitted', () => {
    openSelectorWith()

    const codes = itemCodesInOrder()
    expect(codes.slice(0, 5)).toEqual(['USD', 'EUR', 'JPY', 'GBP', 'CNY'])
    expect(separatorCount()).toBe(1)
  })

  it('uses empty recommendations (only pin + catalog) without static common list', () => {
    openSelectorWith({
      pinnedCurrencyCode: 'USD',
      recommendedCurrencyCodes: [],
    })

    expect(document.querySelectorAll('[cmdk-group-heading]')).toHaveLength(0)
    const codes = itemCodesInOrder()
    expect(codes[0]).toBe('USD')
    expect(codes.indexOf('USD')).toBeLessThan(codes.indexOf('EUR'))
    expect(separatorCount()).toBe(1)
  })

  it('keeps custom and the rest of the catalog after a single divider', () => {
    openSelectorWith({
      pinnedCurrencyCode: 'USD',
      recommendedCurrencyCodes: ['EUR'],
    })

    expect(document.querySelectorAll('[cmdk-group-heading]')).toHaveLength(0)
    const codes = itemCodesInOrder()
    // Priority: pin, then recommendation.
    expect(codes.slice(0, 2)).toEqual(['USD', 'EUR'])
    // Everything else is shown below the separator with no heading.
    expect(codes.filter((code) => code === 'USD')).toHaveLength(1)
    expect(codes.filter((code) => code === 'EUR')).toHaveLength(1)
    expect(codes).toContain('AUD')
    // Custom option (no 3-letter code) appears in the catalog remainder.
    expect(document.body.textContent).toContain('Custom')
    expect(separatorCount()).toBe(1)
  })
})
