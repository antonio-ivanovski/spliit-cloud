import type { CreateExpenseSearch } from '@/router/schemas'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
  SplitMode,
} from '@spliit/domain'
import {
  DEFAULT_CATEGORY_ID,
  PAYMENT_CATEGORY_ID,
  RecurrenceRule,
  amountAsDecimal,
  categoryIdSchema,
  getCurrency,
  randomId,
} from '@spliit/domain'
import { z } from 'zod'

// Storage-units shape returned by `trpc.account.defaultSplit`. Matches
// `defaultSplitSchema` in packages/domain: shares in basis points for
// BY_PERCENTAGE, minor units for BY_AMOUNT, raw counts otherwise.
const savedDefaultSplitSchema = z.object({
  splitMode: z.enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT']),
  paidFor: z.array(
    z.object({
      participant: z.string(),
      shares: z.number().int(),
    }),
  ),
})

export type SavedDefaultSplit = z.infer<typeof savedDefaultSplitSchema>

const itemSplitModeSchema = z.enum([
  'EVENLY',
  'BY_SHARES',
  'BY_PERCENTAGE',
  'BY_AMOUNT',
])

const prefilledExpenseItemsSchema = z.array(
  z.object({
    id: z.string().optional(),
    title: z.string().optional().catch(''),
    unitPrice: z.coerce.number().finite().nonnegative().optional().catch(0),
    quantity: z.coerce.number().int().positive().optional().catch(1),
    splitMode: itemSplitModeSchema.optional().catch('EVENLY'),
    paidFor: z
      .array(
        z.object({
          participant: z.string(),
          shares: z.coerce.number().finite().positive().catch(1),
        }),
      )
      .optional()
      .catch(undefined),
  }),
)

export type GroupShape = NonNullable<AppRouterOutput['groups']['get']['group']>
export type LoadedExpense = NonNullable<
  AppRouterOutput['groups']['expenses']['get']['expense']
>

type ExpenseItemPaidForInput =
  | { ledgerParticipantId: string; shares: number }
  | { participant: string; shares: number }

function getPaidForParticipantId(pf: ExpenseItemPaidForInput): string {
  return 'ledgerParticipantId' in pf ? pf.ledgerParticipantId : pf.participant
}

export type DefaultSplittingOptions = {
  splitMode: SplitMode
  paidFor: ExpenseFormInputValues['paidFor']
}

export const parseCategoryIdFromUrl = (raw: string | null | undefined) => {
  if (!raw) return DEFAULT_CATEGORY_ID
  const parsed = categoryIdSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_CATEGORY_ID
}

const parsePrefilledItems = (
  rawItems: string | undefined,
  group: GroupShape,
): ExpenseFormItemValues[] => {
  if (!rawItems) return []
  try {
    const parsed = prefilledExpenseItemsSchema.safeParse(JSON.parse(rawItems))
    if (!parsed.success) return []

    const validParticipantIds = new Set(group.participants.map((p) => p.id))
    const allParticipants = group.participants.map(({ id }) => ({
      participant: id,
      shares: 1,
    }))

    return parsed.data.map((item) => {
      const seen = new Set<string>()
      const paidFor = (item.paidFor ?? [])
        .filter((row) => {
          if (!validParticipantIds.has(row.participant)) return false
          if (seen.has(row.participant)) return false
          seen.add(row.participant)
          return true
        })
        .map(({ participant, shares }) => ({ participant, shares }))

      return {
        id: item.id ?? randomId(),
        title: item.title ?? '',
        unitPrice: item.unitPrice ?? 0,
        quantity: item.quantity ?? 1,
        splitMode: item.splitMode ?? 'EVENLY',
        paidFor: paidFor.length ? paidFor : allParticipants,
      }
    })
  } catch {
    return []
  }
}

/**
 * Resolve the "neutral" default split for a group (no per-user override):
 * `EVENLY` over all participants. The form later applies the saved
 * default when present (see `buildExpenseFormDefaults`).
 */
export function getNeutralDefaultSplit(
  group: GroupShape,
): DefaultSplittingOptions {
  return {
    splitMode: 'EVENLY',
    paidFor: group.participants.map(({ id }) => ({
      participant: id,
      shares: 1,
    })),
  }
}

/**
 * Convert a persisted default split (storage units: basis points,
 * minor units, raw counts) into the form's display units, filtering
 * out any participant ids that are no longer in the group. Returns
 * null when nothing remains after filtering, so the caller can fall
 * back to the neutral default.
 */
export function savedDefaultToFormValues(
  raw: unknown,
  group: GroupShape,
  groupCurrency: Currency,
): DefaultSplittingOptions | null {
  const parsed = savedDefaultSplitSchema.safeParse(raw)
  if (!parsed.success) return null
  const validIds = new Set(group.participants.map((p) => p.id))
  const paidFor = parsed.data.paidFor
    .filter((row) => validIds.has(row.participant))
    .map(({ participant, shares }) => ({
      participant,
      shares:
        parsed.data.splitMode === 'BY_PERCENTAGE'
          ? shares / 100
          : parsed.data.splitMode === 'BY_AMOUNT'
            ? amountAsDecimal(shares, groupCurrency)
            : shares,
    }))
  if (!paidFor.length) return null
  return { splitMode: parsed.data.splitMode, paidFor }
}

export function buildExpenseFormDefaults(args: {
  isCreate: boolean
  expense?: LoadedExpense
  isCopy?: boolean
  searchParams: CreateExpenseSearch
  group: GroupShape
  groupCurrency: Currency
  currentLedgerParticipantId: string | null | undefined
  reimbursementTitle: string
  /** Persisted default for this user+group, if any. */
  savedDefault?: unknown
}): ExpenseFormInputValues {
  const {
    isCreate,
    expense,
    isCopy,
    searchParams,
    group,
    groupCurrency,
    currentLedgerParticipantId,
    reimbursementTitle,
    savedDefault,
  } = args

  // Copy: prefill like edit, but force today's date.
  if (isCopy && expense) {
    return {
      ...buildExpenseFormDefaults({
        isCreate: false,
        expense,
        searchParams,
        group,
        groupCurrency,
        currentLedgerParticipantId,
        reimbursementTitle,
      }),
      expenseDate: new Date(),
    }
  }

  if (!isCreate && expense) {
    // Storage units (cents / basis points) → display units (decimal /
    // display %). BY_AMOUNT shares use minor-units via amountAsDecimal;
    // BY_PERCENTAGE shares are stored in basis points and shown as %.
    const conversionRequired = !!(
      expense.originalCurrency &&
      expense.originalCurrency.length &&
      expense.originalCurrency !== group.currencyCode
    )
    const originalCurrency = conversionRequired
      ? (getCurrency(expense.originalCurrency ?? '') ?? groupCurrency)
      : groupCurrency
    const conversionRate = expense.conversionRate ?? 1

    // paidFor shares are stored in the expense-currency minor units
    // (original currency when conversion is required, group currency
    // otherwise). Legacy rows that pre-date the server-authoritative
    // conversion model stored BY_AMOUNT shares in the ledger currency;
    // detect that when the stored sum matches ledger `amount` rather
    // than `originalAmount`, then convert back to expense-currency
    // display units via the stored rate (major ÷ rate).
    const storedSharesSum = expense.paidFor.reduce(
      (sum, { shares }) => sum + shares,
      0,
    )
    const paidForInOriginal =
      conversionRequired &&
      expense.originalAmount != null &&
      storedSharesSum === expense.originalAmount
    const paidFor =
      expense.splitMode === 'BY_AMOUNT'
        ? expense.paidFor.map(({ ledgerParticipantId, shares }) => {
            if (paidForInOriginal) {
              return {
                participant: ledgerParticipantId,
                shares: amountAsDecimal(shares, originalCurrency),
              }
            }
            if (conversionRequired) {
              // Legacy ledger-currency minor units → expense major units.
              const ledgerDisplay = amountAsDecimal(shares, groupCurrency)
              return {
                participant: ledgerParticipantId,
                shares: ledgerDisplay / conversionRate,
              }
            }
            return {
              participant: ledgerParticipantId,
              shares: amountAsDecimal(shares, groupCurrency),
            }
          })
        : expense.paidFor.map(({ ledgerParticipantId, shares }) => ({
            participant: ledgerParticipantId,
            shares:
              expense.splitMode === 'BY_PERCENTAGE' ? shares / 100 : shares,
          }))

    // paidBy shares are stored in originalCurrency minor units when
    // conversion is required, otherwise in Ledger minor units.
    const paidByCurrency = conversionRequired ? originalCurrency : groupCurrency
    const paidByList =
      expense.paidBySplitMode === 'BY_AMOUNT'
        ? expense.paidByList.map(({ ledgerParticipantId, shares }) => ({
            participant: ledgerParticipantId,
            shares: amountAsDecimal(shares, paidByCurrency),
          }))
        : expense.paidByList.map(({ ledgerParticipantId, shares }) => ({
            participant: ledgerParticipantId,
            shares:
              expense.paidBySplitMode === 'BY_PERCENTAGE'
                ? shares / 100
                : shares,
          }))

    const itemAmountAsDisplay = (amount: number) =>
      amountAsDecimal(amount, originalCurrency)

    const itemShareAsDisplay = (
      shares: number,
      splitMode: ExpenseFormItemValues['splitMode'],
    ) =>
      splitMode === 'BY_AMOUNT'
        ? itemAmountAsDisplay(shares)
        : splitMode === 'BY_PERCENTAGE'
          ? shares / 100
          : shares

    const items: ExpenseFormItemValues[] = (expense.items ?? []).map((item) => {
      const splitMode = (item.splitMode ??
        'EVENLY') as ExpenseFormItemValues['splitMode']
      const unitPrice = itemAmountAsDisplay(item.unitPrice)
      const paidFor = item.paidFor.map((pf) => ({
        participant: getPaidForParticipantId(pf as ExpenseItemPaidForInput),
        shares: itemShareAsDisplay(pf.shares, splitMode),
      }))
      return {
        id: item.id,
        title: item.title,
        unitPrice,
        quantity: item.quantity,
        paidFor,
        splitMode,
      }
    })

    type ItemizedRemainder = NonNullable<LoadedExpense['itemizedRemainder']>
    type ItemizedRemainderWithParticipant = Omit<
      ItemizedRemainder,
      'paidFor'
    > & {
      paidFor: ExpenseItemPaidForInput[]
    }
    const rawRemainder = (expense as { itemizedRemainder?: unknown })
      .itemizedRemainder as ItemizedRemainderWithParticipant | null | undefined
    const itemizedRemainder = rawRemainder
      ? {
          splitMode: (rawRemainder.splitMode ??
            'EVENLY') as ExpenseFormItemValues['splitMode'],
          paidFor: rawRemainder.paidFor.map((pf) => ({
            participant: getPaidForParticipantId(pf),
            shares: itemShareAsDisplay(
              pf.shares,
              (rawRemainder.splitMode ??
                'EVENLY') as ExpenseFormItemValues['splitMode'],
            ),
          })),
        }
      : {
          splitMode: 'EVENLY' as const,
          paidFor: group.participants.map(({ id }) => ({
            participant: id,
            shares: 1,
          })),
        }

    return {
      title: expense.title,
      expenseDate: expense.expenseDate ?? new Date(),
      amount: conversionRequired
        ? expense.originalAmount != null
          ? amountAsDecimal(expense.originalAmount, originalCurrency)
          : amountAsDecimal(expense.amount, groupCurrency) / conversionRate
        : amountAsDecimal(expense.amount, groupCurrency),
      originalCurrency: expense.originalCurrency ?? group.currencyCode,
      conversionRate: expense.conversionRate ?? undefined,
      conversionType:
        expense.conversionSource === 'CUSTOM' ||
        expense.conversionSource === 'EXCHANGE'
          ? expense.conversionSource
          : expense.originalCurrency && expense.conversionRate
            ? ('CUSTOM' as const)
            : undefined,
      category: expense.categoryId,
      paidBySplitMode: expense.paidBySplitMode,
      paidByList,
      isMultiPayer: expense.paidByList.length > 1,
      paidFor,
      splitMode: expense.splitMode,
      isReimbursement: expense.isReimbursement,
      documents: expense.documents,
      notes: expense.notes ?? '',
      recurrenceRule: expense.recurrenceRule ?? undefined,
      items,
      itemizedRemainder,
    }
  }

  // Create flow: apply the persisted default if present, else fall
  // back to the neutral (EVENLY) split. The form's "Load default" button
  // can later re-apply `savedDefaultToFormValues(savedDefault, ...)` if
  // the user diverges and wants to come back to the saved shape.
  const defaultSplittingOptions =
    savedDefaultToFormValues(savedDefault, group, groupCurrency) ??
    getNeutralDefaultSplit(group)
  const prefilledItems = parsePrefilledItems(searchParams.items, group)
  const hasPrefilledItemSplits = prefilledItems.some(
    (item) => item.paidFor.length > 0,
  )
  const searchCurrency =
    searchParams.originalCurrency && searchParams.originalCurrency.length
      ? (getCurrency(searchParams.originalCurrency) ?? groupCurrency)
      : groupCurrency
  const searchOriginalCurrency =
    searchParams.originalCurrency ?? group.currencyCode ?? undefined
  const defaultPaidByList = currentLedgerParticipantId
    ? [
        {
          participant: currentLedgerParticipantId,
          shares: amountAsDecimal(
            Number(searchParams.amount) || 0,
            searchCurrency,
          ),
        },
      ]
    : []

  if (searchParams.reimbursement) {
    return {
      title: reimbursementTitle,
      expenseDate: new Date(),
      amount:
        searchParams.amount != null
          ? amountAsDecimal(Number(searchParams.amount) || 0, groupCurrency)
          : ('' as unknown as number),
      originalCurrency: group.currencyCode,
      conversionRate: undefined,
      conversionType: undefined,
      category: PAYMENT_CATEGORY_ID,
      paidBySplitMode: 'BY_AMOUNT' as const,
      paidByList: searchParams.from
        ? [
            {
              participant: searchParams.from,
              shares: amountAsDecimal(
                Number(searchParams.amount) || 0,
                groupCurrency,
              ),
            },
          ]
        : [],
      isMultiPayer: false,
      paidFor: searchParams.to
        ? [
            {
              participant: searchParams.to,
              shares: 1,
            },
          ]
        : [],
      isReimbursement: true,
      splitMode: 'EVENLY' as const,
      documents: [],
      notes: '',
      recurrenceRule: RecurrenceRule.NONE,
      itemizedRemainder: {
        splitMode: 'EVENLY' as const,
        paidFor: group.participants.map(({ id }) => ({
          participant: id,
          shares: 1,
        })),
      },
    }
  }

  return {
    title: searchParams.title ?? '',
    expenseDate: searchParams.date ? new Date(searchParams.date) : new Date(),
    amount:
      searchParams.amount != null
        ? amountAsDecimal(Number(searchParams.amount) || 0, searchCurrency)
        : prefilledItems.length
          ? prefilledItems.reduce(
              (sum, item) =>
                sum + Number(item.unitPrice) * Number(item.quantity),
              0,
            )
          : ('' as unknown as number),
    originalCurrency: searchOriginalCurrency,
    conversionRate: undefined,
    conversionType: undefined,
    category: parseCategoryIdFromUrl(searchParams.categoryId),
    paidBySplitMode: 'BY_AMOUNT' as const,
    paidByList: defaultPaidByList,
    isMultiPayer: false,
    paidFor: defaultSplittingOptions.paidFor,
    isReimbursement: false,
    splitMode: hasPrefilledItemSplits
      ? ('ITEMIZED' as const)
      : defaultSplittingOptions.splitMode,
    documents: searchParams.imageUrl
      ? [
          {
            id: randomId(),
            url: searchParams.imageUrl,
            width: Number(searchParams.imageWidth),
            height: Number(searchParams.imageHeight),
          },
        ]
      : [],
    notes: '',
    recurrenceRule: RecurrenceRule.NONE,
    items: prefilledItems,
    itemizedRemainder: {
      splitMode: 'EVENLY' as const,
      paidFor: group.participants.map(({ id }) => ({
        participant: id,
        shares: 1,
      })),
    },
  }
}
