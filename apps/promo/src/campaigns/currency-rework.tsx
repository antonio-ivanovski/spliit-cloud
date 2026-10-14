import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'
import { convertMinorUnitsByRate } from '@web/lib/utils'
import { ArrowRight, CalendarDays, Check, Search, Users, X } from 'lucide-react'

import type { PromoSize } from '../catalog'
import { BrandHeader, Canvas, UiFrame } from '../primitives'

import './currency-rework.css'

/**
 * Fictional expenses; real historical Frankfurter responses, fetched
 * 2026-10-14. Keep these snapshots local so artwork rendering never needs live
 * rates.
 */
export const currencyFixture = {
  group: 'Friends & family',
  oldLedgerCurrency: 'EUR',
  newLedgerCurrency: 'USD',
  expenses: [
    {
      title: 'Dinner',
      amount: 6000,
      currency: 'EUR',
      date: '2025-06-10',
      rate: 1.1419,
      source:
        'https://api.frankfurter.dev/v2/rates?date=2025-06-10&base=EUR&quotes=USD',
    },
    {
      title: 'Groceries',
      amount: 2500,
      currency: 'GBP',
      date: '2025-06-11',
      rate: 1.3503,
      source:
        'https://api.frankfurter.dev/v2/rates?date=2025-06-11&base=GBP&quotes=USD',
    },
    {
      title: 'Transport',
      amount: 1500,
      currency: 'USD',
      date: '2025-06-12',
      rate: 1,
      source: null,
    },
  ],
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100)

function ConversionPreview() {
  return (
    <UiFrame className="currency-preview">
      <div className="currency-dialog-heading">
        <h2>All expenses</h2>
        <X aria-hidden="true" />
      </div>
      <p className="currency-dialog-description">3 expenses · EUR → USD</p>
      <div className="currency-search">
        <Search aria-hidden="true" />
        Search by expense title…
      </div>
      <div className="currency-filters">
        {[
          'All',
          'Needs attention',
          'Converted',
          'Already USD',
          'Manual rate',
        ].map((label, index) => (
          <Button
            key={label}
            size="sm"
            variant={index === 0 ? 'default' : 'outline'}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="currency-rows">
        {currencyFixture.expenses.map((expense) => (
          <div className="currency-row" key={expense.title}>
            <div className="currency-row-title">
              <strong>{expense.title}</strong>
              {expense.currency === 'USD' && (
                <Badge variant="outline">Already USD</Badge>
              )}
            </div>
            <div className="currency-date">{expense.date}</div>
            <div className="currency-conversion">
              <div>
                <span>Was</span>
                <strong>{money(expense.amount, expense.currency)}</strong>
              </div>
              <div className="currency-rate">
                {expense.currency !== 'USD' && (
                  <>
                    <strong>
                      1 {expense.currency} = {expense.rate.toFixed(4)} USD
                    </strong>
                    <span>{expense.date}</span>
                  </>
                )}
              </div>
              <ArrowRight aria-hidden="true" />
              <div className="currency-becomes">
                <span>Becomes</span>
                <strong>
                  {money(
                    convertMinorUnitsByRate(
                      expense.amount,
                      expense.rate,
                      expense.currency,
                      'USD',
                    ),
                    'USD',
                  )}
                </strong>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="currency-dialog-footer">
        <span>Showing 3 of 3</span>
        <Button variant="ghost">Close</Button>
      </div>
    </UiFrame>
  )
}

export function CurrencyPromo(size: PromoSize) {
  return (
    <Canvas {...size} className="currency-promo">
      <BrandHeader />
      <div className="currency-story">
        <h1>
          New currency.
          <br />
          <em>Same group.</em>
        </h1>
        <p className="currency-support">
          Change your group’s settlement currency—even after you’ve added
          expenses.
        </p>
        <p className="currency-clarification">
          Original expense currencies stay intact. Balances and settlement use
          your new choice.
        </p>
        <div className="currency-historical">
          <CalendarDays aria-hidden="true" />
          <strong>
            Use exchange rates from each expense’s date—not today’s rate.
          </strong>
        </div>
      </div>
      <div className="currency-illustration">
        <div className="currency-ledger">
          <span>{currencyFixture.group} · Settlement currency</span>
          <strong>
            EUR <ArrowRight aria-hidden="true" /> USD
          </strong>
        </div>
        <ConversionPreview />
        <p className="currency-location">
          <strong>Group → Tools → Swap currency</strong>
          <br />
          Or change the settlement currency in group settings.
        </p>
      </div>
      <div className="currency-benefits">
        <div>
          <Users aria-hidden="true" />
          <strong>Keep your existing group</strong>
        </div>
        <div>
          <CalendarDays aria-hidden="true" />
          <strong>
            Choose expense-date rates
            <br />
            or a fixed rate per pair
          </strong>
        </div>
        <div>
          <Check aria-hidden="true" />
          <strong>Review before applying</strong>
        </div>
      </div>
      <p className="currency-admin">
        Settlement currency changes are managed by group admins.
      </p>
    </Canvas>
  )
}
