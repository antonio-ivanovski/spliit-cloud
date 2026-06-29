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

export const getDefaultSplittingOptions = (group: GroupShape) => {
  // Default splitting: all ledger participants (active members + pending
  // invitations), evenly. We no longer read per-device splitting defaults
  // from localStorage; server-backed account preferences can replace this in
  // a future pass.
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
  _expenseFormValues: ExpenseFormValues,
) {
  // No-op: per-device splitting defaults were stored in localStorage before
  // the account-backed product. Server-backed account preferences can replace
  // this in a future pass.
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
      splitMode: defaultSplittingOptions.splitMode,
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
