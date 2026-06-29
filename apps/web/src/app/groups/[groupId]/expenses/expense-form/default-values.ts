import type { CreateExpenseSearch } from '@/router/schemas'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  SplitMode,
} from '@spliit/domain'
import {
  DEFAULT_CATEGORY_ID,
  PAYMENT_CATEGORY_ID,
  RecurrenceRule,
  SplitMode as SplitModeEnum,
  amountAsDecimal,
  categoryIdSchema,
  getCurrency,
  randomId,
} from '@spliit/domain'
import { z } from 'zod'

// Zod schema for the localStorage contract so pre-refactor string shares
// ("60", "1") are caught and rejected instead of silently passing through
// the JSON.parse cast.
const storedSplittingOptionsSchema = z.object({
  splitMode: z.nativeEnum(SplitModeEnum).default('EVENLY'),
  paidFor: z
    .array(
      z.object({
        participant: z.string(),
        shares: z.number().finite(),
      }),
    )
    .optional(),
})

export type GroupShape = NonNullable<AppRouterOutput['groups']['get']['group']>
export type LoadedExpense = NonNullable<
  AppRouterOutput['groups']['expenses']['get']['expense']
>

export type DefaultSplittingOptions = {
  splitMode: SplitMode
  paidFor: ExpenseFormInputValues['paidFor']
}

export const parseCategoryIdFromUrl = (raw: string | null | undefined) => {
  if (!raw) return DEFAULT_CATEGORY_ID
  const parsed = categoryIdSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_CATEGORY_ID
}

const STORAGE_KEY = 'spliit.defaultSplittingOptions'

// Form values are persisted verbatim in localStorage: shares in
// display units (decimal major units / display %), splitMode as-is.
export const getDefaultSplittingOptions = (
  group: GroupShape,
): DefaultSplittingOptions => {
  const fromStorage = (() => {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = storedSplittingOptionsSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return null
      const validIds = new Set(group.participants.map((p) => p.id))
      const splitMode = parsed.data.splitMode
      const paidFor = (parsed.data.paidFor ?? []).filter((row) =>
        validIds.has(row.participant),
      )
      if (!paidFor.length) return null
      return { splitMode, paidFor }
    } catch {
      return null
    }
  })()

  if (fromStorage) {
    return fromStorage
  }

  return {
    splitMode: 'EVENLY' as const,
    paidFor: group.participants.map(({ id }) => ({
      participant: id,
      shares: 1,
    })),
  }
}

export async function persistDefaultSplittingOptions(
  _groupId: string,
  formValues: ExpenseFormInputValues,
) {
  if (!formValues.saveDefaultSplittingOptions) return
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: formValues.splitMode,
        paidFor: formValues.paidFor.map(({ participant, shares }) => ({
          participant,
          shares,
        })),
      }),
    )
  } catch {
    // localStorage may be unavailable (private mode, quota); fail silently.
  }
}

export function buildExpenseFormDefaults(args: {
  isCreate: boolean
  expense?: LoadedExpense
  searchParams: CreateExpenseSearch
  group: GroupShape
  groupCurrency: Currency
  currentLedgerParticipantId: string | null | undefined
  reimbursementTitle: string
}): ExpenseFormInputValues {
  const {
    isCreate,
    expense,
    searchParams,
    group,
    groupCurrency,
    currentLedgerParticipantId,
    reimbursementTitle,
  } = args

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
    const conversionRate = expense.conversionRate?.toNumber() ?? 1

    // paidFor shares are stored in Ledger currency minor units and the
    // form schema expects them in the selected expense currency. Convert
    // cents → display units in the Ledger currency first, then divide
    // by the rate when conversion is required so the stored sum still
    // matches `amount` in the form schema's units.
    const paidFor =
      expense.splitMode === 'BY_AMOUNT'
        ? expense.paidFor.map(
            ({ ledgerParticipantId, shares: ledgerShares }) => {
              const ledgerDisplay = amountAsDecimal(ledgerShares, groupCurrency)
              const formDisplay = conversionRequired
                ? ledgerDisplay / conversionRate
                : ledgerDisplay
              return { participant: ledgerParticipantId, shares: formDisplay }
            },
          )
        : expense.paidFor.map(({ ledgerParticipantId, shares }) => ({
            participant: ledgerParticipantId,
            shares: shares / 100,
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
            shares: shares / 100,
          }))

    return {
      title: expense.title,
      expenseDate: expense.expenseDate ?? new Date(),
      amount: conversionRequired
        ? expense.originalAmount != null
          ? amountAsDecimal(expense.originalAmount, originalCurrency)
          : amountAsDecimal(expense.amount, groupCurrency) / conversionRate
        : amountAsDecimal(expense.amount, groupCurrency),
      originalCurrency: expense.originalCurrency ?? group.currencyCode,
      conversionRate: expense.conversionRate?.toNumber(),
      category: expense.categoryId,
      paidBySplitMode: expense.paidBySplitMode,
      paidByList,
      isMultiPayer: expense.paidByList.length > 1,
      paidFor,
      splitMode: expense.splitMode,
      saveDefaultSplittingOptions: false,
      isReimbursement: expense.isReimbursement,
      documents: expense.documents,
      notes: expense.notes ?? '',
      recurrenceRule: expense.recurrenceRule ?? undefined,
    }
  }

  const defaultSplittingOptions = getDefaultSplittingOptions(group)
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
      amount: amountAsDecimal(Number(searchParams.amount) || 0, groupCurrency),
      originalCurrency: group.currencyCode,
      conversionRate: undefined,
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
      saveDefaultSplittingOptions: false,
      documents: [],
      notes: '',
      recurrenceRule: RecurrenceRule.NONE,
    }
  }

  return {
    title: searchParams.title ?? '',
    expenseDate: searchParams.date ? new Date(searchParams.date) : new Date(),
    amount: amountAsDecimal(Number(searchParams.amount) || 0, searchCurrency),
    originalCurrency: searchOriginalCurrency,
    conversionRate: undefined,
    category: parseCategoryIdFromUrl(searchParams.categoryId),
    paidBySplitMode: 'BY_AMOUNT' as const,
    paidByList: defaultPaidByList,
    isMultiPayer: false,
    paidFor: defaultSplittingOptions.paidFor,
    isReimbursement: false,
    splitMode: defaultSplittingOptions.splitMode,
    saveDefaultSplittingOptions: false,
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
  }
}
