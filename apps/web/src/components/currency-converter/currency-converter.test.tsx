import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConverterContent } from '@/components/currency-converter/currency-converter'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'

const _rateMock = vi.fn()
const useCurrencyRateSpy = vi.fn()
const navigateMock = vi.fn()
const accountGroupsQuerySpy = vi.fn()

vi.mock('@/lib/hooks', () => ({
  useCurrencyRate: (...args: unknown[]) => useCurrencyRateSpy(...args),
  useMediaQuery: () => true,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
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
    navigateMock.mockReset()
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
      isLoading: false,
      error: undefined,
    })

    render(<ConverterContent />)

    const fromSelector = screen.getAllByRole('combobox')[0]
    expect(fromSelector).toHaveTextContent(/USD|EUR|JPY/)
    expect(fromSelector).not.toHaveTextContent('ZZZ')
  })
})

describe('CurrencyConverter group navigation', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useCurrencyRateSpy.mockReset()
    navigateMock.mockReset()
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
      isLoading: false,
      error: undefined,
    })

    render(<ConverterContent />)

    expect(accountGroupsQuerySpy).toHaveBeenCalledWith(
      { includeArchived: false },
      { staleTime: 60_000 },
    )

    const amountInput = screen.getByLabelText(/from/i)
    fireEvent.change(amountInput, { target: { value: '100.50' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Trip/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Trip/i }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/groups/$groupId/expenses/create',
      params: { groupId: 'group-1' },
      search: {
        amount: '10050',
        originalCurrency: 'USD',
      },
    })
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
      isLoading: false,
      error: undefined,
    })

    render(<ConverterContent />)

    const amountInput = screen.getByLabelText(/from/i)
    fireEvent.change(amountInput, { target: { value: '5000' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tokyo/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Tokyo/i }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/groups/$groupId/expenses/create',
      params: { groupId: 'group-1' },
      search: {
        amount: '5000',
        originalCurrency: 'JPY',
      },
    })
  })

  it('shows groups disabled when amount is empty and does not navigate', async () => {
    accountGroupsQuerySpy.mockReturnValue({
      data: { groups: [makeGroup('group-1', 'Trip', 'USD')] },
      isLoading: false,
    })
    window.localStorage.setItem('spliit:converter:fromCurrency', 'USD')
    window.localStorage.setItem('spliit:converter:toCurrency', 'USD')
    useCurrencyRateSpy.mockReturnValue({
      data: 1,
      isLoading: false,
      error: undefined,
    })

    render(<ConverterContent />)

    const groupButton = await screen.findByRole('button', { name: /Trip/i })
    expect(groupButton).toBeDisabled()
    fireEvent.click(groupButton)
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
