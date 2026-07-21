import type { SavedSplit } from '@/app/groups/[groupId]/expenses/expense-form/default-split/split-equal'
import type { GroupShape } from '@/app/groups/[groupId]/expenses/expense-form/default-values'
import { ItemParticipantsModal } from '@/app/groups/[groupId]/expenses/expense-form/item-participants-modal'
import { expenseFormInputSchema } from '@/lib/schemas'
import { render, screen } from '@/test/test-utils'
import { zodResolver } from '@hookform/resolvers/zod'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

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
  expenseDate: new Date(),
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
  isReimbursement: false,
  documents: [],
  notes: '',
  recurrenceRule: 'NONE',
  items: [],
  itemizedRemainder: { splitMode: 'EVENLY', paidFor: [] },
}

function ModalHarness({
  item,
  savedDefault,
  hideAmountMode,
  onSaveItem,
}: {
  item: ExpenseFormItemValues
  savedDefault?: SavedSplit | null
  hideAmountMode?: boolean
  onSaveItem?: (next: ExpenseFormItemValues) => void
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
      group={group}
      groupCurrency={EUR}
      item={item}
      onSaveItem={onSaveItem}
      savedDefault={savedDefault ?? null}
      hideAmountMode={hideAmountMode}
    />
  )
}

describe('ItemParticipantsModal — Load default action', () => {
  it('shows Load default when savedDefault exists and draft diverges', () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }

    render(
      <ModalHarness
        item={item}
        savedDefault={{
          splitMode: 'BY_PERCENTAGE',
          paidFor: [
            { participant: alice.id, shares: 5000 },
            { participant: bob.id, shares: 5000 },
          ],
        }}
      />,
    )

    expect(screen.getByRole('button', { name: /^load$/i })).toBeInTheDocument()
  })

  it('hides Load when draft matches savedDefault', () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: alice.id, shares: 50 },
        { participant: bob.id, shares: 50 },
      ],
    }

    render(
      <ModalHarness
        item={item}
        savedDefault={{
          splitMode: 'BY_PERCENTAGE',
          paidFor: [
            { participant: alice.id, shares: 5000 },
            { participant: bob.id, shares: 5000 },
          ],
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: /^load$/i })).toBeNull()
  })

  it('hides Load default when no savedDefault is provided', () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }

    render(<ModalHarness item={item} savedDefault={null} />)

    expect(screen.queryByRole('button', { name: /^load$/i })).toBeNull()
  })

  it('replaces draft with savedDefault values when Load default is clicked', async () => {
    const item: ExpenseFormItemValues = {
      id: 'item-1',
      title: 'Item',
      unitPrice: 10,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [{ participant: alice.id, shares: 1 }],
    }
    let saved: ExpenseFormItemValues | null = null
    const onSaveItem = (next: ExpenseFormItemValues) => {
      saved = next
    }

    const { user } = render(
      <ModalHarness
        item={item}
        savedDefault={{
          splitMode: 'BY_PERCENTAGE',
          paidFor: [
            { participant: alice.id, shares: 6000 },
            { participant: bob.id, shares: 4000 },
          ],
        }}
        onSaveItem={onSaveItem}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^load$/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(saved).not.toBeNull()
    expect(saved!.splitMode).toBe('BY_PERCENTAGE')
    expect(saved!.paidFor).toEqual([
      { participant: alice.id, shares: 60 },
      { participant: bob.id, shares: 40 },
    ])
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
