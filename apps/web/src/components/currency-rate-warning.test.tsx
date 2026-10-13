import { describe, expect, it } from 'vitest'

import { CurrencyRateWarning } from '@/components/currency-rate-warning'
import { defaultLocale } from '@/i18n/request'
import { setUserLocale } from '@/i18n/setup'
import { render, screen } from '@/test/test-utils'
import { getCurrencyRateWarning } from '@spliit/domain/currency'

async function renderWarning(kind: 'frozen' | 'statutory' | 'triangulated') {
  await setUserLocale(defaultLocale)
  const warning =
    kind === 'frozen'
      ? getCurrencyRateWarning({
          base: 'BGN',
          target: 'JPY',
          requestedDate: '2026-06-15',
          asOfDate: '2025-12-31',
          sources: [{ provider: 'frankfurter', base: 'BGN', target: 'JPY' }],
        })
      : kind === 'statutory'
        ? getCurrencyRateWarning({
            base: 'BGN',
            target: 'EUR',
            requestedDate: '2026-06-15',
            asOfDate: '2026-06-15',
            sources: [{ provider: 'fixed', base: 'BGN', target: 'EUR' }],
          })
        : getCurrencyRateWarning({
            base: 'BGN',
            target: 'USD',
            requestedDate: '2026-06-15',
            asOfDate: '2026-06-15',
            sources: [
              { provider: 'fixed', base: 'BGN', target: 'EUR' },
              { provider: 'frankfurter', base: 'EUR', target: 'USD' },
            ],
          })
  render(<CurrencyRateWarning warning={warning} />)
}

describe('CurrencyRateWarning', () => {
  it('renders nothing without a warning', async () => {
    await setUserLocale(defaultLocale)
    const { container } = render(<CurrencyRateWarning warning={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('escalates a frozen end-of-life quote with the frozen date', async () => {
    await renderWarning('frozen')
    expect(screen.getByRole('alert')).toHaveTextContent('2025-12-31')
    expect(screen.getByRole('alert')).toHaveTextContent('BGN')
  })

  it('escalates a statutory fixed rate', async () => {
    await renderWarning('statutory')
    expect(screen.getByRole('alert')).toHaveTextContent('1.95583')
  })

  it('escalates a triangulated fixed-plus-live rate', async () => {
    await renderWarning('triangulated')
    expect(screen.getByRole('alert')).toHaveTextContent('BGN')
  })
})
