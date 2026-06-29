import type { CreateExpenseSearch } from '@/router/schemas'
import type { AppRouterOutput } from '@spliit/api/router'
import type { Currency, ExpenseFormValues } from '@spliit/domain'
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

export const parseCategoryIdFromUrl = (raw: string | null | undefined) => {
  if (!raw) return DEFAULT_CATEGORY_ID
  const parsed = categoryIdSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_CATEGORY_ID
}

const STORAGE_KEY = 'spliit.defaultSplittingOptions'

export const getDefaultSplittingOptions = (group: GroupShape) => {
  const fromStorage = (() => {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as {
        splitMode?: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE' | 'BY_AMOUNT'
        paidFor?: Array<{ participant: string; shares: string | number }>
      }
      const validIds = new Set(group.participants.map((p) => p.id))
      const splitMode = parsed.splitMode ?? ('EVENLY' as const)
      // Non-BY_AMOUNT modes store shares in the form's pre-transform
      // representation (e.g. "50" for 50%, "1" for one share). The form
      // schema's .transform multiplies those by 100 to produce basis
      // points only when the value is a string, so the loaded shape
      // already needs to be in basis points for the BY_PERCENTAGE /
      // BY_SHARES validation sum to pass.
      const paidFor = (parsed.paidFor ?? [])
        .filter((row) => validIds.has(row.participant))
        .map((row) => ({
          participant: row.participant,
          shares: (splitMode === 'BY_AMOUNT'
            ? Number(row.shares)
            : Number(row.shares) * 100) as any,
        }))
      if (!paidFor.length) return null
      return {
        splitMode,
        paidFor,
      }
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
      shares: '1' as any,
    })),
  }
}

export async function persistDefaultSplittingOptions(
  _groupId: string,
  expenseFormValues: ExpenseFormValues,
) {
  if (!expenseFormValues.saveDefaultSplittingOptions) return
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: expenseFormValues.splitMode,
        paidFor: expenseFormValues.paidFor,
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
}): ExpenseFormValues {
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
    return {
      title: expense.title,
      expenseDate: expense.expenseDate ?? new Date(),
      amount: amountAsDecimal(expense.amount, groupCurrency),
      originalCurrency: expense.originalCurrency ?? group.currencyCode,
      originalAmount:
        expense.originalAmount != null
          ? amountAsDecimal(
              expense.originalAmount,
              expense.originalCurrency
                ? (getCurrency(expense.originalCurrency) ?? groupCurrency)
                : groupCurrency,
            )
          : undefined,
      conversionRate: expense.conversionRate?.toNumber(),
      category: expense.categoryId,
      paidBySplitMode: expense.paidBySplitMode,
      paidByList: expense.paidByList.map(({ ledgerParticipantId, shares }) => {
        const rowCurrency = expense.originalCurrency
          ? (getCurrency(expense.originalCurrency) ?? groupCurrency)
          : groupCurrency
        return {
          participant: ledgerParticipantId,
          shares: (expense.paidBySplitMode === 'BY_AMOUNT'
            ? amountAsDecimal(shares, rowCurrency)
            : (shares / 100).toString()) as any,
        }
      }),
      isMultiPayer: expense.paidByList.length > 1,
      paidFor: expense.paidFor.map(({ ledgerParticipantId, shares }) => ({
        participant: ledgerParticipantId,
        shares: (expense.splitMode === 'BY_AMOUNT'
          ? amountAsDecimal(shares, groupCurrency)
          : (shares / 100).toString()) as any,
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
          shares: (Number(searchParams.amount) || 0) as any,
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
              ) as any,
            },
          ]
        : [],
      isMultiPayer: false,
      paidFor: searchParams.to
        ? [
            {
              participant: searchParams.to,
              shares: '1' as any,
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
    amount: Number(searchParams.amount) || 0,
    originalCurrency: group.currencyCode ?? undefined,
    originalAmount: undefined,
    conversionRate: undefined,
    category: parseCategoryIdFromUrl(searchParams.categoryId),
    paidBySplitMode: 'BY_AMOUNT' as const,
    paidByList: defaultPaidByList as any,
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
