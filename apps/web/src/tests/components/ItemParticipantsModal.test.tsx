import { zodResolver } from '@hookform/resolvers/zod'
import { type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

import type { GroupShape } from '@/app/groups/[groupId]/expenses/expense-form/default-values'
import { ItemParticipantsModal } from '@/app/groups/[groupId]/expenses/expense-form/item-participants-modal'
import type { SplitPreset } from '@/app/groups/[groupId]/expenses/expense-form/split-presets'
import { expenseFormInputSchema } from '@/lib/schemas'
import { render, screen, fireEvent } from '@/test/test-utils'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'

const EUR: Currency = {
  code: 'EUR',
  symbol: '€',
  rounding: 0,
  decimal_digits: 2,
}

const alice = { id: 'alice-id', name: 'Alice' }
const bob = { id: 'bob-id', name: 'Bob' }
const admin = { id: 'admin-id', name: 'Admin' }

const group = {
  id: 'group-1',
  ledgerId: 'ledger-1',
  name: 'Test',
  archived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  information: null,
  currency: 'EUR',
  currencyCode: 'EUR',
  ledger: {
    id: 'ledger-1',
    currency: 'EUR',
    currencyCode: 'EUR',
    groupId: 'group-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  participants: [admin, alice, bob],
  members: [],
  invitations: [],
} as unknown as GroupShape

const EMPTY_DEFAULTS: ExpenseFormInputValues = {
  title: '',
  expenseDay: '2026-01-01',
  expenseTime: '12:00',
  expenseTimeZone: 'UTC',
  amount: 0,
  originalCurrency: 'EUR',
  conversionRate: undefined,
  conversionType: undefined,
  category: 'general',
  paidBySplitMode: 'BY_AMOUNT',
  paidByList: [],
  isMultiPayer: false,
  paidFor: [],
  splitMode: 'EVENLY',
  documents: [],
  notes: '',
  recurrenceRule: 'NONE',
  items: [],
  itemizedRemainder: { splitMode: 'EVENLY', paidFor: [] },
}

function ModalHarness({
  item,
  presets,
  canManage,
  readOnly,
  hideAmountMode,
  onSaveItem,
  group: groupOverride,
}: {
  item: ExpenseFormItemValues
  presets?: SplitPreset[]
  canManage?: boolean
  readOnly?: boolean
  hideAmountMode?: boolean
  onSaveItem?: (next: ExpenseFormItemValues) => void
  group?: GroupShape
}): ReactElement {
  const form = useForm<ExpenseFormInputValues>({
    resolver: zodResolver(expenseFormInputSchema) as never,
    defaultValues: EMPTY_DEFAULTS,
  })
  return (
    <ItemParticipantsModal
      open
      onOpenChange={() => {}}
      form={form}
      itemIndex={0}
      group={groupOverride ?? group}
      groupCurrency={EUR}
      item={item}
      onSaveItem={onSaveItem}
      presets={presets ?? []}
      canManage={canManage ?? false}
      readOnly={readOnly}
      hideAmountMode={hideAmountMode}
    />
  )
}

describe('ItemParticipantsModal — viewport behavior', () => {
  it('keeps a large participant list inside a bounded, scrollable modal body', () => {
    const largeGroup = {
      ...group,
      participants: Array.from({ length: 30 }, (_, index) => ({
        id: `participant-${index}`,
        name: `Participant ${index + 1}`,
      })),
    } as unknown as GroupShape

    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [],
    }

    render(<ModalHarness item={item} group={largeGroup} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass(
      'sm:max-h-[calc(100dvh-2rem)]',
      'sm:grid-rows-[auto_minmax(0,1fr)_auto]',
      'sm:overflow-hidden',
    )

    const body = dialog.querySelector('[class*="sm:overflow-y-auto"]')
    expect(body).toHaveClass(
      'sm:min-h-0',
      'sm:overflow-y-auto',
      'sm:overscroll-contain',
    )
    expect(screen.getByText('Participant 30')).toBeInTheDocument()
  })
})

describe('ItemParticipantsModal — split preset action', () => {
  const percentagePreset: SplitPreset = {
    id: 'preset-1',
    name: 'Dinner split',
    scope: 'PERSONAL',
    ownerAccountId: 'account-1',
    target: 'PAID_FOR',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    splitMode: 'BY_PERCENTAGE',
    participants: [
      { participant: alice.id, shares: 6000 },
      { participant: bob.id, shares: 4000 },
    ],
  }

  it('shows the chooser when presets are available', () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }
    render(<ModalHarness item={item} presets={[percentagePreset]} />)

    expect(
      screen.getByRole('button', { name: /^load split preset$/i }),
    ).toBeInTheDocument()
  })

  it('applies the selected preset to the item draft', async () => {
    let saved: ExpenseFormItemValues | null = null
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }

    const { user } = render(
      <ModalHarness
        item={item}
        presets={[percentagePreset]}
        onSaveItem={(next) => {
          saved = next
        }}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /^load split preset$/i }),
    )
    await user.click(screen.getByRole('button', { name: /dinner split/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(saved).not.toBeNull()
    expect(saved!.splitMode).toBe('BY_PERCENTAGE')
    expect(saved!.paidFor).toEqual([
      { participant: alice.id, shares: 60 },
      { participant: bob.id, shares: 40 },
    ])
  })

  it('hides the action for read-only item editors', () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }

    render(<ModalHarness item={item} presets={[percentagePreset]} readOnly />)

    expect(
      screen.queryByRole('button', { name: /^load split preset$/i }),
    ).toBeNull()
  })
})

describe('ItemParticipantsModal — BY_SHARES decimal entry', () => {
  it('keeps intermediate decimal states while typing 0.5 and saves the display value', async () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'BY_SHARES',
      paidFor: [
        { participant: alice.id, shares: 1 },
        { participant: bob.id, shares: 1 },
      ],
    }
    const saved: { value: ExpenseFormItemValues | null } = { value: null }
    const onSaveItem = (next: ExpenseFormItemValues) => {
      saved.value = next
    }

    const { user } = render(
      <ModalHarness item={item} onSaveItem={onSaveItem} />,
    )

    const aliceInput = screen.getByRole('textbox', {
      name: 'Split value for Alice',
    })
    // Character-by-character typing must keep "0", "0." and "0.5" visible:
    // every non-empty value keeps the row, so the first digit never makes
    // the input vanish.
    await user.clear(aliceInput)
    await user.type(aliceInput, '0')
    expect(aliceInput).toHaveValue('0')
    await user.type(aliceInput, '.')
    expect(aliceInput).toHaveValue('0.')
    await user.type(aliceInput, '5')
    expect(aliceInput).toHaveValue('0.5')

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(saved.value).not.toBeNull()
    expect(saved.value!.paidFor).toEqual([
      { participant: bob.id, shares: 1 },
      { participant: alice.id, shares: '0.5' as unknown as number },
    ])
  })

  it('keeps "1." while typing .1 after a starting share of 1', async () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'BY_SHARES',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }
    const saved: { value: ExpenseFormItemValues | null } = { value: null }

    const { user } = render(
      <ModalHarness
        item={item}
        onSaveItem={(next) => {
          saved.value = next
        }}
      />,
    )

    const aliceInput = screen.getByRole('textbox', {
      name: 'Split value for Alice',
    })
    // Focus selects the starting value, so typing replaces it: '1' keeps
    // the value, the '.' intermediate "1." state survives, and '1' finishes.
    await user.type(aliceInput, '1')
    await user.type(aliceInput, '.')
    expect(aliceInput).toHaveValue('1.')
    await user.type(aliceInput, '1')
    expect(aliceInput).toHaveValue('1.1')

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(saved.value?.paidFor[0]?.shares).toBe('1.1' as unknown as number)
  })

  it('selects the full split value on focus so typing replaces it', async () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'BY_SHARES',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }

    const { user } = render(<ModalHarness item={item} onSaveItem={() => {}} />)

    const aliceInput = screen.getByRole('textbox', {
      name: 'Split value for Alice',
    }) as HTMLInputElement
    expect(aliceInput).toHaveValue('1')
    fireEvent.focus(aliceInput)
    expect(aliceInput.selectionStart).toBe(0)
    expect(aliceInput.selectionEnd).toBe(1)
    await user.type(aliceInput, '5')
    expect(aliceInput).toHaveValue('5')
  })

  it('steps fractional shares by 0.1 and removes the row at zero', async () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'BY_SHARES',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }

    const { user } = render(<ModalHarness item={item} onSaveItem={() => {}} />)

    const aliceInput = screen.getByRole('textbox', {
      name: 'Split value for Alice',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '0.5')
    // 0.5 + -> 0.6 (0.xx range steps by 0.1)
    await user.click(
      screen.getByRole('button', { name: 'Increase shares for Alice' }),
    )
    expect(aliceInput).toHaveValue('0.6')
    // 0.6 - -> 0.5
    await user.click(
      screen.getByRole('button', { name: 'Decrease shares for Alice' }),
    )
    expect(aliceInput).toHaveValue('0.5')
    // 0.1 - removes the row
    await user.clear(aliceInput)
    await user.type(aliceInput, '0.1')
    await user.click(
      screen.getByRole('button', { name: 'Decrease shares for Alice' }),
    )
    expect(aliceInput).toHaveValue('')
  })

  it('resets custom shares and deselection to all ones', async () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'BY_SHARES',
      paidFor: [
        { participant: alice.id, shares: 3 },
        { participant: bob.id, shares: 1 },
      ],
    }
    const saved: { value: ExpenseFormItemValues | null } = { value: null }

    const { user } = render(
      <ModalHarness
        item={item}
        onSaveItem={(next) => {
          saved.value = next
        }}
      />,
    )

    const aliceInput = screen.getByRole('textbox', {
      name: 'Split value for Alice',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '0.5')
    // Deselect Bob, then Reset: all participants at 1.
    const bobToggle = document.querySelector<HTMLButtonElement>(
      '[data-id="bob-id/BY_SHARES/EUR"] button[aria-pressed]',
    )
    if (!bobToggle) throw new Error('Bob row toggle not found')
    await user.click(bobToggle)
    await user.click(screen.getByRole('button', { name: /^reset$/i }))

    expect(aliceInput).toHaveValue('1')
    expect(
      screen.getByRole('textbox', { name: 'Split value for Bob' }),
    ).toHaveValue('1')
    expect(
      screen.getByRole('textbox', { name: 'Split value for Admin' }),
    ).toHaveValue('1')

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(saved.value?.paidFor).toEqual([
      { participant: admin.id, shares: 1 },
      { participant: alice.id, shares: 1 },
      { participant: bob.id, shares: 1 },
    ])
  })

  it('select all adds missing participants without overwriting edited values', async () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'BY_SHARES',
      paidFor: [
        { participant: alice.id, shares: 3 },
        { participant: bob.id, shares: 1 },
      ],
    }
    const saved: { value: ExpenseFormItemValues | null } = { value: null }

    const { user } = render(
      <ModalHarness
        item={item}
        onSaveItem={(next) => {
          saved.value = next
        }}
      />,
    )

    const aliceInput = screen.getByRole('textbox', {
      name: 'Split value for Alice',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '0.5')
    // Deselect Bob, then Select all: Alice keeps 0.5, Bob is restored at 1.
    const bobToggle = document.querySelector<HTMLButtonElement>(
      '[data-id="bob-id/BY_SHARES/EUR"] button[aria-pressed]',
    )
    if (!bobToggle) throw new Error('Bob row toggle not found')
    await user.click(bobToggle)
    await user.click(screen.getByRole('button', { name: /select all/i }))

    expect(aliceInput).toHaveValue('0.5')
    expect(
      screen.getByRole('textbox', { name: 'Split value for Bob' }),
    ).toHaveValue('1')
  })
})

describe('ItemParticipantsModal — hideAmountMode', () => {
  it('hides the BY_AMOUNT split card when hideAmountMode is true', () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }

    render(<ModalHarness item={item} hideAmountMode />)

    expect(screen.queryByRole('radio', { name: /by amount/i })).toBeNull()
    expect(screen.getByRole('radio', { name: /evenly/i })).toBeInTheDocument()
  })

  it('keeps BY_AMOUNT visible when hideAmountMode is false (default)', () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }

    render(<ModalHarness item={item} />)

    expect(
      screen.getByRole('radio', { name: /by amount/i }),
    ).toBeInTheDocument()
  })
})
