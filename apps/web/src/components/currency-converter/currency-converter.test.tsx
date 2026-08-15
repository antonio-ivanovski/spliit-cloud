import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConverterContent } from '@/components/currency-converter/currency-converter'
import { defaultLocale } from '@/i18n/request'
import { setUserLocale } from '@/i18n/setup'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'

const _rateMock = vi.fn()
const useCurrencyRateSpy = vi.fn()
const accountGroupsQuerySpy = vi.fn()

vi.mock('@/lib/hooks', () => ({
  useCurrencyRate: (...args: unknown[]) => useCurrencyRateSpy(...args),
  useMediaQuery: () => true,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string
    search?: unknown
    children?: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} data-search={JSON.stringify(search)} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      groups: {
        useQuery: (...args: unknown[]) => {
          accountGroupsQuerySpy(...args)
          return (
            accountGroupsQuerySpy.getMockImplementation()?.(...args) ?? {
              data: { groups: [] },
              isLoading: false,
            }
          )
        },
      },
    },
  },
}))

const currencies = [
  { code: 'EUR', symbol: '€', rounding: 0, decimal_digits: 2, name: 'Euro' },
  {
    code: 'USD',
    symbol: '$',
    rounding: 0,
    decimal_digits: 2,
    name: 'US Dollar',
  },
  {
    code: 'JPY',
    symbol: '¥',
    rounding: 0,
    decimal_digits: 0,
    name: 'Japanese Yen',
  },
]

vi.mock(import('@/lib/currency'), async (importActual) => {
  const actual = await importActual()
  return {
    ...actual,
    useCurrencies: () => currencies,
  }
})

afterEach(async () => {
  await setUserLocale(defaultLocale, { notify: false, persist: false })
})

const staleError = new RangeError('stale rate')
const hardError = new Error('network failure')

function makeGroup(
  id: string,
  name: string,
  currencyCode: string,
  starred = false,
) {
  return {
    id,
    name,
    groupType: 'GROUP' as const,
    archived: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    latestExpenseCreatedAt: null,
    preference: { starred, hidden: false },
    ledger: { currency: '$', currencyCode },
  }
}

describe('CurrencyConverter stale rate gating', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useCurrencyRateSpy.mockReset()
    accountGroupsQuerySpy.mockReset()
    accountGroupsQuerySpy.mockReturnValue({
      data: { groups: [] },
      isLoading: false,
    })
  })

  it('shows muted stale note when rate is stale (RangeError) but still renders preview', async () => {
    window.localStorage.setItem('spliit:converter:fromCurrency', 'EUR')
    window.localStorage.setItem('spliit:converter:toCurrency', 'USD')
    useCurrencyRateSpy.mockReturnValue({
      data: 1.1,
      via: undefined,
      sources: [{ provider: 'frankfurter', base: 'EUR', target: 'USD' }],
      isLoading: false,
      error: staleError,
    })
    render(<ConverterContent />)

    const amountInput = screen.getByLabelText(/from/i)
    fireEvent.change(amountInput, { target: { value: '100' } })

    await waitFor(() => {
      expect(screen.queryByText(/using rate from/i)).toBeInTheDocument()
    })
    expect(
      screen.queryByText(/could not load exchange rate/i),
    ).not.toBeInTheDocument()
  })

  it('shows destructive rateError when rate fails for a non-RangeError reason', async () => {
    window.localStorage.setItem('spliit:converter:fromCurrency', 'EUR')
    window.localStorage.setItem('spliit:converter:toCurrency', 'USD')
    useCurrencyRateSpy.mockReturnValue({
      data: undefined,
      via: undefined,
      sources: [],
      isLoading: false,
      error: hardError,
    })
    render(<ConverterContent />)

    const amountInput = screen.getByLabelText(/from/i)
    fireEvent.change(amountInput, { target: { value: '100' } })

    await waitFor(() => {
      expect(
        screen.getByText(/could not load exchange rate/i),
      ).toBeInTheDocument()
    })
  })

  it('drops stored currency codes that are no longer in the catalog', () => {
    window.localStorage.setItem('spliit:converter:fromCurrency', 'ZZZ')
    window.localStorage.setItem('spliit:converter:toCurrency', 'EUR')

    useCurrencyRateSpy.mockReturnValue({
      data: 1,
      via: undefined,
      sources: [],
      isLoading: false,
      error: undefined,
    })

    render(<ConverterContent />)

    const fromSelector = screen.getAllByRole('combobox')[0]
    expect(fromSelector).toHaveTextContent(/USD|EUR|JPY/)
    expect(fromSelector).not.toHaveTextContent('ZZZ')
  })
})

describe('CurrencyConverter localized amount editing', () => {
  it('keeps a German decimal separator visible throughout editing', async () => {
    await setUserLocale('de-DE', { notify: false, persist: false })
    useCurrencyRateSpy.mockReturnValue({
      data: 1,
      via: undefined,
      sources: [],
      isLoading: false,
      error: undefined,
    })

    render(<ConverterContent />)

    const amountInput = screen.getByRole('textbox')
    fireEvent.change(amountInput, { target: { value: '1,' } })
    expect(amountInput).toHaveValue('1,')

    fireEvent.change(amountInput, { target: { value: '1,50' } })
    expect(amountInput).toHaveValue('1,50')
  })
})

describe('CurrencyConverter group navigation', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useCurrencyRateSpy.mockReset()
    accountGroupsQuerySpy.mockReset()
  })

  it('navigates with amount as minor units for 2-decimal currencies (USD)', async () => {
    accountGroupsQuerySpy.mockReturnValue({
      data: { groups: [makeGroup('group-1', 'Trip', 'USD')] },
      isLoading: false,
    })
    window.localStorage.setItem('spliit:converter:fromCurrency', 'USD')
    window.localStorage.setItem('spliit:converter:toCurrency', 'USD')
    useCurrencyRateSpy.mockReturnValue({
      data: 1,
      via: undefined,
      sources: [],
      isLoading: false,
      error: undefined,
    })

    render(<ConverterContent />)

    expect(accountGroupsQuerySpy).toHaveBeenCalledWith(
      { includeArchived: false },
      { staleTime: 60_000, enabled: true },
    )

    const amountInput = screen.getByLabelText(/from/i)
    fireEvent.change(amountInput, { target: { value: '100.50' } })

    const groupLink = await screen.findByRole('link', { name: /Trip/i })
    expect(groupLink).toHaveAttribute(
      'href',
      '/groups/$groupId/expenses/create',
    )
    expect(groupLink).toHaveAttribute(
      'data-search',
      JSON.stringify({
        amount: '10050',
        originalCurrency: 'USD',
      }),
    )
  })

  it('navigates with integer minor units for 0-decimal currencies (JPY)', async () => {
    accountGroupsQuerySpy.mockReturnValue({
      data: { groups: [makeGroup('group-1', 'Tokyo', 'JPY')] },
      isLoading: false,
    })
    window.localStorage.setItem('spliit:converter:fromCurrency', 'JPY')
    window.localStorage.setItem('spliit:converter:toCurrency', 'JPY')
    useCurrencyRateSpy.mockReturnValue({
      data: 1,
      via: undefined,
      sources: [],
      isLoading: false,
      error: undefined,
    })

    render(<ConverterContent />)

    const amountInput = screen.getByLabelText(/from/i)
    fireEvent.change(amountInput, { target: { value: '5000' } })

    const groupLink = await screen.findByRole('link', { name: /Tokyo/i })
    expect(groupLink).toHaveAttribute(
      'href',
      '/groups/$groupId/expenses/create',
    )
    expect(groupLink).toHaveAttribute(
      'data-search',
      JSON.stringify({
        amount: '5000',
        originalCurrency: 'JPY',
      }),
    )
  })

  it('shows groups disabled when amount is empty', async () => {
    accountGroupsQuerySpy.mockReturnValue({
      data: { groups: [makeGroup('group-1', 'Trip', 'USD')] },
      isLoading: false,
    })
    window.localStorage.setItem('spliit:converter:fromCurrency', 'USD')
    window.localStorage.setItem('spliit:converter:toCurrency', 'USD')
    useCurrencyRateSpy.mockReturnValue({
      data: 1,
      via: undefined,
      sources: [],
      isLoading: false,
      error: undefined,
    })

    render(<ConverterContent />)

    const groupButton = await screen.findByRole('button', { name: /Trip/i })
    expect(groupButton).toBeDisabled()
    expect(
      screen.queryByRole('link', { name: /Trip/i }),
    ).not.toBeInTheDocument()
  })
})

describe('CurrencyConverter offline', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useCurrencyRateSpy.mockReset()
    accountGroupsQuerySpy.mockReset()
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  it('shows the offline message and does not fetch rates or groups', () => {
    useCurrencyRateSpy.mockReturnValue({
      data: undefined,
      via: undefined,
      sources: [],
      isLoading: false,
      error: undefined,
    })
    accountGroupsQuerySpy.mockReturnValue({
      data: undefined,
      isLoading: false,
    })

    render(<ConverterContent />)

    expect(screen.getByTestId('offline-empty-state')).toHaveTextContent(
      /full offline support for this feature is high on our priority list/i,
    )
    expect(screen.queryByLabelText(/from/i)).not.toBeInTheDocument()
    expect(accountGroupsQuerySpy).toHaveBeenCalledWith(
      { includeArchived: false },
      expect.objectContaining({ enabled: false }),
    )
    expect(useCurrencyRateSpy).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(String),
      expect.any(String),
      { enabled: false },
    )
  })
})
