import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CurrencySelector } from '@/components/currency-selector'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import type { DisplayCurrency } from '@/lib/currency'
import { render, screen } from '@/test/test-utils'

vi.mock(import('@/lib/hooks'), async (importActual) => {
  const actual = await importActual()
  return { ...actual, useMediaQuery: () => true }
})

const currencies: DisplayCurrency[] = [
  {
    code: 'EUR',
    symbol: '€',
    rounding: 0,
    decimal_digits: 2,
    name: 'Euro',
  },
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

describe('CurrencySelector inside modal dialog (desktop)', () => {
  it('lets the user pick a currency while nested in a Dialog', async () => {
    const user = userEvent.setup({
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    })
    const onValueChange = vi.fn()

    render(
      <ResponsiveDialog open>
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>Convert currency</ResponsiveDialogTitle>
          <CurrencySelector
            currencies={currencies}
            defaultValue="USD"
            isLoading={false}
            onValueChange={onValueChange}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    )

    await user.click(screen.getByRole('combobox'))

    const euro = await screen.findByRole('option', { name: /Euro \(EUR\)/ })
    await user.click(euro)

    expect(onValueChange).toHaveBeenCalledWith('EUR')
  })
})
