import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CurrencyConversionWizard } from './currency-conversion-wizard'

vi.mock('@/lib/hooks', () => ({
  useCurrencyRates: () => ({
    data: [],
    isFetching: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

describe('CurrencyConversionWizard', () => {
  it('supports a fixed custom rate and reports the resolved choice to its owner', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <CurrencyConversionWizard
        pairs={[{ base: 'EUR', target: 'GBP', dates: ['2026-01-02'] }]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('radio', { name: /fixed custom rate/i }))
    await user.type(
      screen.getByRole('spinbutton', { name: /custom rate/i }),
      '1.2',
    )

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({
        policies: { 'EUR|GBP': { type: 'fixedCustom', rate: 1.2 } },
        rates: { '2026-01-02|EUR|GBP': 1.2 },
        ready: true,
      })
    })
    expect(
      screen.queryByRole('button', { name: /^continue$/i }),
    ).not.toBeInTheDocument()
  })
})
