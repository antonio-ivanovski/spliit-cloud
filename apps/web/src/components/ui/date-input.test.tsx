import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n/react'
import { defaultLocale } from '@/i18n/request'
import { setUserLocale } from '@/i18n/setup'
import { useMediaQuery } from '@/lib/hooks'

import { DateInput } from './date-input'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from './responsive-dialog'
import {
  formatDateInputDisplay,
  parseDateInputDisplay,
  parseIsoCalendarDate,
  toIsoCalendarDate,
} from './date-input-utils'

vi.mock('@/lib/hooks', () => ({
  useMediaQuery: vi.fn(() => true),
}))

const mediaQueryMock = vi.mocked(useMediaQuery)

beforeEach(() => {
  mediaQueryMock.mockReturnValue(true)
})

afterEach(async () => {
  vi.useRealTimers()
  cleanup()
  await setUserLocale(defaultLocale, { notify: false, persist: false })
})

describe('DateInput', () => {
  it('renders the ISO value in the app-selected locale', async () => {
    await setUserLocale('mk-MK', { notify: false, persist: false })

    const { getByTestId } = render(
      <I18nProvider>
        <DateInput
          data-testid="date-input"
          pickerTitle="Expense date"
          value="2026-08-06"
        />
      </I18nProvider>,
    )

    expect(getByTestId('date-input')).toHaveAttribute('lang', 'mk-MK')
    expect(getByTestId('date-input')).toHaveValue('06.08.2026')
  })

  it('returns ISO calendar dates selected from the localized calendar', async () => {
    await setUserLocale('mk-MK', { notify: false, persist: false })
    const onValueChange = vi.fn()
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <DateInput
          data-testid="date-input"
          defaultValue="2026-08-06"
          pickerTitle="Expense date"
          onValueChange={onValueChange}
        />
      </I18nProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Expense date…' }))
    await user.click(
      await screen.findByRole('button', { name: /07 август 2026$/u }),
    )

    expect(onValueChange).toHaveBeenCalledWith('2026-08-07')
    expect(screen.getByTestId('date-input')).toHaveValue('07.08.2026')
  })

  it('opens the localized calendar in a bottom drawer on mobile', async () => {
    mediaQueryMock.mockReturnValue(false)
    await setUserLocale('mk-MK', { notify: false, persist: false })
    const onValueChange = vi.fn()
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <DateInput
          data-testid="date-input"
          onValueChange={onValueChange}
          pickerTitle="Датум на трошок"
          value="2026-08-06"
        />
      </I18nProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Датум на трошок…' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Датум на трошок' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /07 август 2026$/u }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /07 август 2026$/u }),
    )

    expect(onValueChange).toHaveBeenCalledWith('2026-08-07')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('expands inline instead of nesting a drawer inside a mobile responsive dialog', async () => {
    mediaQueryMock.mockReturnValue(false)
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <ResponsiveDialog open>
          <ResponsiveDialogContent>
            <ResponsiveDialogTitle>Print report</ResponsiveDialogTitle>
            <DateInput pickerTitle="From date" value="2026-08-06" />
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </I18nProvider>,
    )

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'From date…' }))

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText('August 2026')).toBeInTheDocument()
    expect(
      document.querySelector('[data-slot="date-picker-chrome"]'),
    ).toBeInTheDocument()
  })

  it('uses year and month dropdowns in a stable six-week calendar', async () => {
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <DateInput pickerTitle="Expense date" value="2026-02-06" />
      </I18nProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Expense date…' }))

    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    expect(screen.getAllByRole('gridcell')).toHaveLength(42)
  })

  it('selects timezone-aware presets and disables presets outside bounds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T00:30:00.000Z'))
    const onValueChange = vi.fn()

    render(
      <I18nProvider>
        <DateInput
          pickerTitle="Expense date"
          value=""
          min="2026-08-06"
          max="2026-08-07"
          presets={['yesterday', 'today', 'tomorrow']}
          timeZone="America/Los_Angeles"
          onValueChange={onValueChange}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expense date…' }))

    expect(screen.getByRole('button', { name: 'Yesterday' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Today' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }))
    expect(onValueChange).toHaveBeenCalledWith('2026-08-07')
    expect(
      screen.queryByRole('button', { name: 'Tomorrow' }),
    ).not.toBeInTheDocument()
  })

  it('round-trips ISO calendar dates without a UTC offset', () => {
    const date = parseIsoCalendarDate('2026-08-06')
    expect(date).toBeDefined()
    expect(toIsoCalendarDate(date!)).toBe('2026-08-06')
    expect(parseIsoCalendarDate('2026-02-30')).toBeUndefined()
  })

  it('opens on a controlled value that arrives after mount', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <I18nProvider>
        <DateInput pickerTitle="Expense date" value="" />
      </I18nProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Expense date…' }))
    rerender(
      <I18nProvider>
        <DateInput pickerTitle="Expense date" value="2031-02-06" />
      </I18nProvider>,
    )

    expect(await screen.findByText('February 2031')).toBeInTheDocument()
  })

  it('allows localized keyboard editing and clearing optional dates', async () => {
    await setUserLocale('mk-MK', { notify: false, persist: false })
    const onValueChange = vi.fn()
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <DateInput
          data-testid="date-input"
          clearLabel="Исчисти датум"
          pickerTitle="Датум на трошок"
          defaultValue="2026-08-06"
          onValueChange={onValueChange}
        />
      </I18nProvider>,
    )

    const input = screen.getByTestId('date-input')
    await user.clear(input)
    await user.type(input, '07.08.2026')
    await user.tab()

    expect(onValueChange).toHaveBeenLastCalledWith('2026-08-07')
    expect(input).toHaveValue('07.08.2026')

    await user.click(screen.getByRole('button', { name: 'Исчисти датум' }))
    expect(onValueChange).toHaveBeenLastCalledWith('')
    expect(input).toHaveValue('')
  })

  it('uses locale-specific numeric field order and separators', () => {
    expect(formatDateInputDisplay('2026-08-06', 'mk-MK')).toBe('06.08.2026')
    expect(formatDateInputDisplay('2026-08-06', 'en-US')).toBe('08/06/2026')
    expect(
      toIsoCalendarDate(parseDateInputDisplay('06.08.2026', 'mk-MK')!),
    ).toBe('2026-08-06')
    expect(
      toIsoCalendarDate(
        parseDateInputDisplay('٠٦‏/٠٨‏/٢٠٢٦', 'ar-SA')!,
      ),
    ).toBe('2026-08-06')
  })
})
