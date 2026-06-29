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
  amountAsDecimal,
  categoryIdSchema,
  getCurrency,
  randomId,
} from '@spliit/domain'

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
      const parsed = JSON.parse(raw) as {
        splitMode?: SplitMode
        paidFor?: Array<{ participant: string; shares: number }>
      }
      const validIds = new Set(group.participants.map((p) => p.id))
      const splitMode = parsed.splitMode ?? ('EVENLY' as const)
      const paidFor = (parsed.paidFor ?? []).filter((row) =>
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
  expenseFormValues: ExpenseFormInputValues,
) {
  if (!expenseFormValues.saveDefaultSplittingOptions) return
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: expenseFormValues.splitMode,
        paidFor: expenseFormValues.paidFor.map(({ participant, shares }) => ({
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
    const rowCurrency = (originalCurrency: string | null | undefined) =>
      originalCurrency
        ? (getCurrency(originalCurrency) ?? groupCurrency)
        : groupCurrency
    const toFormShares = (
      shares: number,
      splitMode: SplitMode,
      currency: Currency,
    ): number =>
      splitMode === 'BY_AMOUNT'
        ? amountAsDecimal(shares, currency)
        : shares / 100

    return {
      title: expense.title,
      expenseDate: expense.expenseDate ?? new Date(),
      amount: amountAsDecimal(expense.amount, groupCurrency),
      originalCurrency: expense.originalCurrency ?? group.currencyCode,
      originalAmount:
        expense.originalAmount != null
          ? amountAsDecimal(
              expense.originalAmount,
              rowCurrency(expense.originalCurrency),
            )
          : undefined,
      conversionRate: expense.conversionRate?.toNumber(),
      category: expense.categoryId,
      paidBySplitMode: expense.paidBySplitMode,
      paidByList: expense.paidByList.map(({ ledgerParticipantId, shares }) => ({
        participant: ledgerParticipantId,
        shares: toFormShares(
          shares,
          expense.paidBySplitMode,
          rowCurrency(expense.originalCurrency),
        ),
      })),
      isMultiPayer: expense.paidByList.length > 1,
      paidFor: expense.paidFor.map(({ ledgerParticipantId, shares }) => ({
        participant: ledgerParticipantId,
        shares: toFormShares(shares, expense.splitMode, groupCurrency),
      })),
      splitMode: expense.splitMode,
      saveDefaultSplittingOptions: false,
      isReimbursement: expense.isReimbursement,
      documents: expense.documents,
      notes: expense.notes ?? '',
      recurrenceRule: expense.recurrenceRule ?? undefined,
    }
  }

  const defaultSplittingOptions = getDefaultSplittingOptions(group)
  const defaultPaidByList = currentLedgerParticipantId
    ? [
        {
          participant: currentLedgerParticipantId,
          shares: amountAsDecimal(
            Number(searchParams.amount) || 0,
            groupCurrency,
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
      originalAmount: undefined,
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
    amount: amountAsDecimal(Number(searchParams.amount) || 0, groupCurrency),
    originalCurrency: group.currencyCode ?? undefined,
    originalAmount: undefined,
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
