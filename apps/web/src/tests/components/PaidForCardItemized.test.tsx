import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

import { PaidForCard } from '@/app/groups/[groupId]/expenses/expense-form/paid-for-card'
import type { ShareInputRefs } from '@/app/groups/[groupId]/expenses/expense-form/share-row-input'
import { Form } from '@/components/ui/form'
import { render, screen, within } from '@/test/test-utils'
import type { Currency, ExpenseFormInputValues } from '@spliit/domain'

const EUR: Currency = {
  code: 'EUR',
  symbol: '€',
  rounding: 0,
  decimal_digits: 2,
}

const group = {
  id: 'group-1',
  currencyCode: 'EUR',
  participants: [
    { id: 'alice-id', name: 'Alice' },
    { id: 'bob-id', name: 'Bob' },
    { id: 'carol-id', name: 'Carol' },
  ],
} as unknown as Parameters<typeof PaidForCard>[0]['group']

function baseDefaults(
  overrides?: Partial<ExpenseFormInputValues>,
): ExpenseFormInputValues {
  return {
    title: 'Dinner',
    expenseDay: '2026-01-01',
    expenseTime: '12:00',
    expenseTimeZone: 'UTC',
    amount: 30,
    originalCurrency: 'EUR',
    conversionRate: undefined,
    conversionType: undefined,
    category: 'general',
    paidBySplitMode: 'BY_AMOUNT',
    paidByList: [],
    isMultiPayer: false,
    paidFor: [],
    splitMode: 'ITEMIZED',
    documents: [],
    notes: '',
    recurrenceRule: 'NONE',
    items: [
      {
        id: 'item-1',
        title: 'Pizza',
        unitPrice: 20,
        quantity: 1,
        splitMode: 'EVENLY',
        paidFor: [
          { participant: 'alice-id', shares: 1 },
          { participant: 'bob-id', shares: 1 },
        ],
      },
    ],
    itemizedRemainder: {
      allocationMode: 'CUSTOM',
      splitMode: 'EVENLY',
      paidFor: [{ participant: 'alice-id', shares: 1 }],
    },
    ...overrides,
  }
}

function Harness({
  defaults,
  formRef,
}: {
  defaults: ExpenseFormInputValues
  formRef?: { current: UseFormReturn<ExpenseFormInputValues> | null }
}) {
  const form = useForm<ExpenseFormInputValues>({ defaultValues: defaults })
  const [, setManuallyEdited] = useState<Set<string>>(new Set())
  const inputRefs = useRef(new Map()) as ShareInputRefs
  useEffect(() => {
    if (formRef) formRef.current = form
  })
  const splitMode = useWatch({ control: form.control, name: 'splitMode' })
  const items = useWatch({ control: form.control, name: 'items' })

  return (
    <Form {...form}>
      <PaidForCard
        form={form}
        group={group}
        groupCurrency={EUR}
        payerCurrency={EUR}
        readOnly={false}
        sExpense="Expense"
        setManuallyEditedParticipants={setManuallyEdited}
        presets={[]}
        isCreate
        inputRefs={inputRefs}
      />
      <button
        type="button"
        data-testid="remainder-to-bob"
        onClick={() =>
          form.setValue(
            'itemizedRemainder',
            {
              allocationMode: 'CUSTOM',
              splitMode: 'EVENLY',
              paidFor: [{ participant: 'bob-id', shares: 1 }],
            },
            { shouldDirty: true, shouldTouch: true, shouldValidate: true },
          )
        }
      >
        remainder to bob
      </button>
      <div data-testid="probe-split">{splitMode}</div>
      <div data-testid="probe-items">
        {JSON.stringify(
          (items ?? []).map((item) => ({
            title: item.title,
            unitPrice: item.unitPrice,
          })),
        )}
      </div>
    </Form>
  )
}

describe('PaidForCard — itemized split option', () => {
  it('shows Itemized selected with nonzero totals, updates with remainder edits, and exits with confirmation while retaining items', async () => {
    const formRef: {
      current: UseFormReturn<ExpenseFormInputValues> | null
    } = { current: null }
    const { user } = render(
      <Harness defaults={baseDefaults()} formRef={formRef} />,
    )

    // Itemized is an explicit selected option, first of five.
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(5)
    expect(radios[0]).toHaveAccessibleName(/itemized/i)
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')

    // Compact derived totals: nonzero shares only, no disabled picker.
    const itemizedCard = radios[0].closest('div')
    expect(itemizedCard).not.toBeNull()
    const itemizedContent = within(itemizedCard as HTMLElement)
    expect(itemizedContent.getByText('Alice')).toBeInTheDocument()
    expect(itemizedContent.getByText('Bob')).toBeInTheDocument()
    expect(itemizedContent.queryByText('Carol')).toBeNull()
    expect(document.querySelector('[aria-pressed]')).toBeNull()
    // Alice 20 (10 item + 10 remainder), Bob 10.
    expect(itemizedContent.getByText(/20[.,]00/)).toBeInTheDocument()

    // Changing remainder allocation alone updates the derived totals.
    await user.click(screen.getByTestId('remainder-to-bob'))
    expect(itemizedContent.getByText('Alice')).toBeInTheDocument()
    expect(itemizedContent.getByText(/10[.,]00/)).toBeInTheDocument()
    expect(itemizedContent.getByText(/20[.,]00/)).toBeInTheDocument()

    // Selecting another mode asks for confirmation; cancel keeps Itemized.
    await user.click(screen.getByRole('radio', { name: /evenly/i }))
    expect(
      screen.getByRole('dialog', { name: /switch split mode/i }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.getByTestId('probe-split')).toHaveTextContent('ITEMIZED')

    // Confirm exits to the ordinary split with items retained.
    await user.click(screen.getByRole('radio', { name: /evenly/i }))
    await user.click(screen.getByRole('button', { name: /^switch$/i }))
    expect(screen.getByTestId('probe-split')).toHaveTextContent('EVENLY')
    expect(screen.getByTestId('probe-items')).toHaveTextContent('Pizza')
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('radio', { name: /evenly/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(formRef.current?.getValues('items')).toHaveLength(1)
  })

  it('shows an assign-people hint when no nonzero shares are derived', () => {
    render(
      <Harness
        defaults={baseDefaults({
          amount: 0,
          items: [
            {
              id: 'item-1',
              title: 'Empty',
              unitPrice: 0,
              quantity: 1,
              splitMode: 'EVENLY',
              paidFor: [{ participant: 'alice-id', shares: 1 }],
            },
          ],
          itemizedRemainder: {
            allocationMode: 'CUSTOM',
            splitMode: 'EVENLY',
            paidFor: [{ participant: 'alice-id', shares: 1 }],
          },
        })}
      />,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveAccessibleName(/itemized/i)
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/assign people to items/i)).toBeInTheDocument()
  })
})
