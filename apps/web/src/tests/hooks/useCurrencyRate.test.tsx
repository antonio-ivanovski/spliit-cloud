import { useCurrencyRate } from '@/lib/hooks'
import { render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock tRPC client ───────────────────────────────────────────────────

const mockUseQuery = vi.fn()

vi.mock('@/trpc/client', () => ({
  trpc: {
    currency: {
      getRate: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
    },
  },
}))

// ── Helper component ───────────────────────────────────────────────────

function TestComponent({
  date,
  baseCurrency,
  targetCurrency,
}: {
  date: Date
  baseCurrency: string
  targetCurrency: string
}) {
  const result = useCurrencyRate(date, baseCurrency, targetCurrency)
  return (
    <div>
      <div data-testid="data">
        {result.data !== undefined ? String(result.data) : 'undefined'}
      </div>
      <div data-testid="error">
        {result.error !== null ? result.error.message : 'null'}
      </div>
      <div data-testid="error-type">
        {result.error !== null ? result.error.constructor.name : 'null'}
      </div>
      <div data-testid="isLoading">{result.isLoading ? 'true' : 'false'}</div>
      <button
        data-testid="refresh"
        onClick={() => {
          result.refresh()
        }}
      >
        refresh
      </button>
    </div>
  )
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('useCurrencyRate', () => {
  beforeEach(() => {
    mockUseQuery.mockReset()
  })

  it('returns undefined data when currencies are the same (enabled=false)', () => {
    const date = new Date('2026-06-28')
    // When enabled=false, React Query keeps data as undefined
    mockUseQuery.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })

    render(
      <TestComponent date={date} baseCurrency="EUR" targetCurrency="EUR" />,
    )

    expect(screen.getByTestId('data')).toHaveTextContent('undefined')
    expect(screen.getByTestId('error')).toHaveTextContent('null')
  })

  it('returns undefined data when baseCurrency is empty', () => {
    const date = new Date('2026-06-28')
    mockUseQuery.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })

    render(<TestComponent date={date} baseCurrency="" targetCurrency="USD" />)

    expect(screen.getByTestId('data')).toHaveTextContent('undefined')
    expect(screen.getByTestId('error')).toHaveTextContent('null')
  })

  it('fetches exchange rate when currencies differ', () => {
    const date = new Date('2026-06-28')
    mockUseQuery.mockReturnValue({
      data: { rate: 1.0923, asOfDate: '2026-06-28' },
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })

    render(
      <TestComponent date={date} baseCurrency="EUR" targetCurrency="USD" />,
    )

    expect(screen.getByTestId('data')).toHaveTextContent('1.0923')
    expect(screen.getByTestId('error')).toHaveTextContent('null')
  })

  it('handles HTTP error response', () => {
    const date = new Date('2026-06-28')
    mockUseQuery.mockReturnValue({
      data: undefined,
      error: { message: 'BAD_REQUEST' },
      isLoading: false,
      refetch: vi.fn(),
    })

    render(
      <TestComponent date={date} baseCurrency="EUR" targetCurrency="USD" />,
    )

    expect(screen.getByTestId('data')).toHaveTextContent('undefined')
    expect(screen.getByTestId('error')).toHaveTextContent('BAD_REQUEST')
  })

  it('returns RangeError when asOfDate does not match requested date', () => {
    const date = new Date('2026-07-01') // future date
    mockUseQuery.mockReturnValue({
      data: { rate: 1.0923, asOfDate: '2026-06-28' }, // API fell back to latest available
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })

    render(
      <TestComponent date={date} baseCurrency="EUR" targetCurrency="USD" />,
    )

    expect(screen.getByTestId('data')).toHaveTextContent('1.0923')
    expect(screen.getByTestId('error-type')).toHaveTextContent('RangeError')
    expect(screen.getByTestId('error')).toHaveTextContent('2026-06-28')
  })

  it('returns exchange rate from response and refresh triggers refetch', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    mockUseQuery.mockReturnValue({
      data: { rate: 0.85, asOfDate: '2026-06-28' },
      error: null,
      isLoading: false,
      refetch,
    })

    const { user } = render(
      <TestComponent
        date={new Date('2026-06-28')}
        baseCurrency="USD"
        targetCurrency="EUR"
      />,
    )

    expect(screen.getByTestId('data')).toHaveTextContent('0.85')
    await user.click(screen.getByTestId('refresh'))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
