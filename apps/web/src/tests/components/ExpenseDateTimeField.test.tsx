import { useForm, useWatch } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildExpenseTimeTimeline,
  ExpenseDateTimeField,
} from '@/app/groups/[groupId]/expenses/expense-form/expense-date-time-field'
import { Form } from '@/components/ui/form'
import { render, screen } from '@/test/test-utils'

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

function Harness({
  date = '2026-08-12',
  time = '23:45',
  timeZone = 'UTC',
}: {
  date?: string
  time?: string
  timeZone?: string
}) {
  const form = useForm<Values>({
    defaultValues: {
      expenseDay: date,
      expenseTime: time,
      expenseTimeZone: timeZone,
    },
  })
  const values = useWatch({ control: form.control })
  const selectedDate = values.expenseDay ?? ''

  return (
    <Form {...form}>
      <ExpenseDateTimeField
        form={form as never}
        readOnly={false}
        sExpense="Expense"
      />
      <output data-testid="selection">
        {selectedDate}|{values.expenseTime}|{values.expenseTimeZone}
      </output>
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

  it('shows the calendar and time timeline together on desktop', async () => {
    const { user } = render(<Harness />)

    const trigger = screen.getByRole('combobox', { name: /expense date/i })
    expect(trigger).toHaveClass('w-full')
    expect(
      screen.queryByRole('textbox', { name: /expense date/i }),
    ).not.toBeInTheDocument()
    await user.click(trigger)

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

  it('wires the label to the composite trigger and supports roving keys', async () => {
    const { user } = render(<Harness time="12:00" />)

    await user.click(screen.getByText('Expense date'))
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

  it('updates both date and time when a mobile selection crosses midnight', async () => {
    isDesktop = false
    const { user } = render(<Harness />)

    await user.click(screen.getByRole('combobox', { name: /expense date/i }))
    await user.click(screen.getByRole('button', { name: 'Time' }))

    expect(screen.getAllByText('Changes date').length).toBeGreaterThan(0)
    const nextMidnight = document.querySelector<HTMLButtonElement>(
      '[data-date="2026-08-13"][data-time-option="00:00"]',
    )
    expect(nextMidnight).not.toBeNull()
    expect(nextMidnight?.parentElement).toHaveClass('grid-cols-4')
    await user.click(nextMidnight!)

    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-13|00:00|UTC',
    )
    const selectedDayHeader = screen.getByText(/Thu, Aug 13/).closest('.sticky')
    expect(selectedDayHeader).not.toHaveTextContent('Changes date')
    const previousDayHeader = screen.getByText(/Wed, Aug 12/).closest('.sticky')
    expect(previousDayHeader).toHaveTextContent('Changes date')
  })

  it('selects an embedded timezone without changing wall date or time', async () => {
    isDesktop = false
    const { user } = render(<Harness time="10:30" />)

    await user.click(screen.getByRole('combobox', { name: /expense date/i }))
    await user.click(screen.getByRole('button', { name: /UTC/ }))
    await user.type(
      screen.getByPlaceholderText('Search timezones or cities'),
      'Skopje',
    )
    await user.keyboard('{Home}{Enter}')

    expect(screen.getByTestId('selection')).toHaveTextContent(
      '2026-08-12|10:30|Europe/Skopje',
    )
    expect(screen.getByRole('button', { name: /Skopje/ })).toBeInTheDocument()
  })
})
