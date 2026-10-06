import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  buildExpenseTimeTimeline,
  ExpenseDateTimeField,
} from '@/app/groups/[groupId]/expenses/expense-form/expense-date-time-field'
import { Form } from '@/components/ui/form'
import { render, screen } from '@/test/test-utils'
import { parseTimeMinutes } from '@spliit/domain'

let isDesktop = true

vi.mock('@/lib/hooks', async (importOriginal) => ({
  ...(await importOriginal()),
  useMediaQuery: () => isDesktop,
}))

type Values = {
  expenseDay: string
  expenseTime: string
  expenseTimeZone: string
}

const harnessSchema = z.object({
  expenseDay: z.iso.date(),
  expenseTime: z.string().refine((value) => {
    try {
      parseTimeMinutes(value)
      return true
    } catch {
      return false
    }
  }, 'invalidTime'),
  expenseTimeZone: z.string().min(1),
})

function Harness({
  date = '2026-08-12',
  time = '23:45',
  timeZone = 'UTC',
  readOnly = false,
}: {
  date?: string
  time?: string
  timeZone?: string
  readOnly?: boolean
}) {
  const form = useForm<Values>({
    resolver: zodResolver(harnessSchema),
    shouldFocusError: false,
    defaultValues: {
      expenseDay: date,
      expenseTime: time,
      expenseTimeZone: timeZone,
    },
  })
  const values = useWatch({ control: form.control })
  const selectedDate = values.expenseDay ?? ''
  const [submitResult, setSubmitResult] = useState('none')

  return (
    <Form {...form}>
      <ExpenseDateTimeField
        form={form as never}
        readOnly={readOnly}
        sExpense="Expense"
      />
      <button
        type="button"
        onClick={() => {
          void form.handleSubmit(
            () => setSubmitResult('valid'),
            () => setSubmitResult('invalid'),
          )()
        }}
      >
        Save-ish
      </button>
      <output data-testid="selection">
        {selectedDate}|{values.expenseTime}|{values.expenseTimeZone}
      </output>
      <output data-testid="submit-result">{submitResult}</output>
    </Form>
  )
}

describe('buildExpenseTimeTimeline', () => {
  it('covers the surrounding dates and preserves an exact off-grid time', () => {
    const timeline = buildExpenseTimeTimeline({
      dateIso: '2026-08-12',
      time: '12:07',
    })

    expect(timeline.some((option) => option.key === '2026-08-12T12:07')).toBe(
      true,
    )
    expect(new Set(timeline.map((option) => option.dateIso))).toEqual(
      new Set(['2026-08-11', '2026-08-12', '2026-08-13']),
    )
    expect(timeline[0]!.key).toBe('2026-08-11T12:07')
    expect(timeline.at(-1)!.key).toBe('2026-08-13T12:07')
  })

  it('keeps wall-clock labels stable and includes DST-gap choices', () => {
    const ordinary = buildExpenseTimeTimeline({
      dateIso: '2026-03-28',
      time: '12:07',
    })
    expect(ordinary.some((option) => option.key === '2026-03-28T12:07')).toBe(
      true,
    )

    const transition = buildExpenseTimeTimeline({
      dateIso: '2026-03-29',
      time: '03:30',
    })
    expect(
      transition.some(
        (option) =>
          option.dateIso === '2026-03-29' && option.time.startsWith('02:'),
      ),
    ).toBe(true)
  })
})

describe('ExpenseDateTimeField', () => {
  beforeEach(() => {
    isDesktop = true
  })

  it('renders typed date and time inputs with a picker button on desktop', async () => {
    const { user } = render(<Harness />)

    const dateInput = screen.getByRole('textbox', { name: 'Date' })
    const timeInput = screen.getByRole('textbox', { name: 'Time' })
    expect(dateInput).toHaveValue('08/12/2026')
    expect(timeInput).toHaveValue('23:45')

    await user.click(screen.getByRole('button', { name: /expense date/i }))

    expect(screen.getByRole('grid')).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Time' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Yesterday' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(
      screen.queryByText('24 hours before and after the selected time'),
    ).not.toBeInTheDocument()
  })

  it('labels the date and time inputs with a named picker button', async () => {
    render(<Harness />)

    expect(screen.getByText('Expense date')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Date' })).toHaveValue(
      '08/12/2026',
    )
    expect(screen.getByRole('textbox', { name: 'Time' })).toHaveValue('23:45')
    expect(
      screen.getByRole('button', { name: 'Expense date' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Expense date' }),
    ).toBeInTheDocument()
  })

  it('supports roving keys in the timeline', async () => {
    const { user } = render(<Harness time="12:00" />)

    await user.click(screen.getByRole('button', { name: /expense date/i }))
    expect(screen.getByRole('listbox', { name: 'Time' })).toBeInTheDocument()

    const selected = document.querySelector<HTMLButtonElement>(
      '[data-time-key="2026-08-12T12:00"]',
    )!
    selected.focus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|12:15|UTC',
    )
  })

  it('commits a typed date on Enter without submitting', async () => {
    const { user } = render(<Harness />)

    const dateInput = screen.getByRole('textbox', { name: 'Date' })
    await user.clear(dateInput)
    await user.type(dateInput, '08/13/2026')
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-13|23:45|UTC',
    )
    expect(screen.getByTestId('submit-result')).toHaveTextContent('none')
    expect(screen.getByRole('textbox', { name: 'Date' })).toHaveValue(
      '08/13/2026',
    )
  })

  it('accepts arbitrary minutes and normalizes single-digit hours', async () => {
    const { user } = render(<Harness />)

    const timeInput = screen.getByRole('textbox', { name: 'Time' })
    await user.clear(timeInput)
    await user.type(timeInput, '12:07')
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|12:07|UTC',
    )

    await user.clear(timeInput)
    await user.type(timeInput, '9:05')
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|09:05|UTC',
    )
    expect(screen.getByRole('textbox', { name: 'Time' })).toHaveValue('09:05')
  })

  it('keeps an invalid date visible with an error and blocks submit', async () => {
    const { user } = render(<Harness />)

    const dateInput = screen.getByRole('textbox', { name: 'Date' })
    await user.clear(dateInput)
    await user.type(dateInput, 'not a date')
    await user.tab()

    expect(screen.getByText('Enter a valid date.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Date' })).toHaveValue(
      'not a date',
    )
    // The invalid draft forced the form value invalid instead of keeping
    // the previous valid date around for a silent save.
    expect(screen.getByTestId('selection')).toHaveTextContent('|23:45|UTC')

    await user.click(screen.getByRole('button', { name: 'Save-ish' }))
    expect(screen.getByTestId('submit-result')).toHaveTextContent('invalid')
  })

  it('rejects impossible dates and empty input, Escape restores', async () => {
    const { user } = render(<Harness />)

    const dateInput = screen.getByRole('textbox', { name: 'Date' })
    await user.clear(dateInput)
    await user.type(dateInput, '02/30/2026')
    await user.tab()
    expect(screen.getByText('Enter a valid date.')).toBeInTheDocument()

    await user.click(dateInput)
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Enter a valid date.')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Date' })).toHaveValue(
      '08/12/2026',
    )
    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|23:45|UTC',
    )

    await user.clear(dateInput)
    await user.tab()
    expect(screen.getByText('Enter a valid date.')).toBeInTheDocument()
  })

  it('rejects invalid times and blocks submit', async () => {
    const { user } = render(<Harness />)

    const timeInput = screen.getByRole('textbox', { name: 'Time' })
    await user.clear(timeInput)
    await user.type(timeInput, '25:00')
    await user.tab()

    expect(screen.getByText('Enter a valid time (HH:mm).')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Time' })).toHaveValue('25:00')

    await user.click(screen.getByRole('button', { name: 'Save-ish' }))
    expect(screen.getByTestId('submit-result')).toHaveTextContent('invalid')
  })

  it('keeps picker math on the last valid date after an invalid draft', async () => {
    const { user } = render(<Harness />)

    const dateInput = screen.getByRole('textbox', { name: 'Date' })
    await user.clear(dateInput)
    await user.type(dateInput, '09/05/2026')
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-09-05|23:45|UTC',
    )

    await user.clear(dateInput)
    await user.type(dateInput, 'bogus')
    await user.tab()
    expect(screen.getByText('Enter a valid date.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /expense date/i }))
    // The timeline stays centered on Sep 5 and only the two neighboring
    // days are badged as changing the date.
    expect(screen.getByText(/Sat, Sep 5/)).toBeInTheDocument()
    expect(screen.getAllByText('Changes date')).toHaveLength(2)
  })

  it('replaces a date draft when the picker selects a date', async () => {
    const { user } = render(<Harness />)

    const dateInput = screen.getByRole('textbox', { name: 'Date' })
    await user.clear(dateInput)
    await user.type(dateInput, 'bogus')
    await user.tab()
    expect(screen.getByText('Enter a valid date.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /expense date/i }))
    await user.click(screen.getByRole('button', { name: 'Tomorrow' }))

    expect(screen.queryByText('Enter a valid date.')).not.toBeInTheDocument()
    const iso = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(Date.now() + 864e5)
    expect(screen.getByTestId('selection')).toHaveTextContent(
      `${iso}|23:45|UTC`,
    )
  })

  it('picks a mobile wheel time without changing the date', async () => {
    isDesktop = false
    const { user } = render(<Harness />)

    expect(screen.getByRole('textbox', { name: 'Date' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /expense date/i }))
    await user.click(screen.getByRole('button', { name: 'Time' }))

    // Wheels replace the grid on mobile: no date-coupled options.
    expect(screen.getByRole('listbox', { name: 'Hour' })).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Minute' })).toBeInTheDocument()
    expect(screen.queryByText('Changes date')).not.toBeInTheDocument()

    const minuteMidnight = document.querySelector<HTMLButtonElement>(
      '[data-wheel="minute"] [data-wheel-value="0"]',
    )
    expect(minuteMidnight).not.toBeNull()
    await user.click(minuteMidnight!)

    // 23:45 -> 23:00 on the same day (no midnight crossing).
    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|23:00|UTC',
    )
  })

  it('applies a mobile quick chip without changing the date', async () => {
    isDesktop = false
    const { user } = render(<Harness />)

    await user.click(screen.getByRole('button', { name: /expense date/i }))
    await user.click(screen.getByRole('button', { name: 'Time' }))

    await user.click(screen.getByRole('button', { name: /Morning/ }))

    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|09:00|UTC',
    )
  })

  it('toggles AM/PM on the mobile wheels', async () => {
    isDesktop = false
    const { user } = render(<Harness />)

    await user.click(screen.getByRole('button', { name: /expense date/i }))
    await user.click(screen.getByRole('button', { name: 'Time' }))

    // en-US renders 12-hour drums: 23:45 shows as 11:45 PM.
    expect(screen.getByRole('listbox', { name: 'AM/PM' })).toBeInTheDocument()

    const am = document.querySelector<HTMLButtonElement>(
      '[data-wheel="period"] [data-wheel-value="am"]',
    )
    expect(am).not.toBeNull()
    await user.click(am!)

    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|11:45|UTC',
    )
  })

  it('moves mobile wheel focus with arrow keys', async () => {
    isDesktop = false
    const { user } = render(<Harness time="12:00" />)

    await user.click(screen.getByRole('button', { name: /expense date/i }))
    await user.click(screen.getByRole('button', { name: 'Time' }))

    // 12:00 PM: ArrowDown on the minute drum picks minute 01.
    const minuteList = screen.getByRole('listbox', { name: 'Minute' })
    minuteList.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|12:01|UTC',
    )
  })

  it('selects an embedded timezone without changing wall date or time', async () => {
    isDesktop = false
    const { user } = render(<Harness time="10:30" />)

    await user.click(screen.getByRole('button', { name: /UTC/ }))
    await user.type(
      screen.getByPlaceholderText('Search timezones or cities'),
      'Skopje',
    )
    await user.keyboard('{Home}{Enter}')

    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|10:30|Europe/Skopje',
    )
    expect(
      screen.getAllByRole('button', { name: /Skopje/ }).length,
    ).toBeGreaterThan(0)
  })

  it('disables typed inputs and the picker when read-only', () => {
    render(<Harness readOnly />)

    expect(screen.getByRole('textbox', { name: 'Date' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Time' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /expense date/i })).toBeDisabled()
  })
})
