import { GroupRole, prisma } from '@spliit/db'
import {
  calculateMigrationRewrite,
  exchangeRateLookupDate,
  getCurrency,
  getMigrationEligibility,
  isSupportedMigrationCurrency,
  migrationPairPolicySchema,
  migrationRateKey,
  type EffectiveOriginalExpense,
  type MigrationExpenseInput,
} from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getCurrencyRates, type BatchRateRequest } from '../currency-rates'
import { buildGroupActivityData, logActivity } from './activities'

export const migrationPairChoicesSchema = z.record(
  z.string().min(1),
  migrationPairPolicySchema,
)

export type MigrationPairChoices = z.infer<typeof migrationPairChoicesSchema>

export class CurrencyMigrationError extends Error {
  constructor(
    message: string,
    readonly kind: 'INVALID' | 'PROVIDER_UNAVAILABLE' | 'NOT_FOUND' = 'INVALID',
  ) {
    super(message)
    this.name = 'CurrencyMigrationError'
  }
}

type StoredMigrationExpense = MigrationExpenseInput & {
  expenseDate: Date
  conversionSource: 'EXCHANGE' | 'CUSTOM' | null
}

type MigrationLoadedState = {
  group: {
    id: string
    ledgerId: string
    archived: boolean
    ledger: { currency: string; currencyCode: string | null }
  }
  expenses: StoredMigrationExpense[]
}

async function loadMigrationState(
  groupId: string,
): Promise<MigrationLoadedState> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      ledgerId: true,
      archived: true,
      ledger: { select: { currency: true, currencyCode: true } },
    },
  })
  if (!group) throw new CurrencyMigrationError('Group not found', 'NOT_FOUND')

  const expenses = await prisma.expense.findMany({
    where: { ledgerId: group.ledgerId },
    select: {
      id: true,
      expenseDate: true,
      amount: true,
      originalAmount: true,
      originalCurrency: true,
      conversionSource: true,
    },
    orderBy: { id: 'asc' },
  })
  return { group, expenses }
}

export type CurrencyMigrationPreview = {
  groupId: string
  oldCurrencyCode: string | null
  destinationCurrencyCode: string
  hasExpenses: boolean
  eligible: boolean
  unsupportedCurrencies: ReturnType<
    typeof getMigrationEligibility
  >['unsupportedCurrencies']
  pairs: ReturnType<typeof getMigrationEligibility>['pairs']
  customRateExpenseCount: number
  expenses: Array<{
    id: string
    date: string
    base: string
    amount: number
  }>
}

export async function getCurrencyMigrationPreview(args: {
  groupId: string
  destinationCurrencyCode: string
}): Promise<CurrencyMigrationPreview> {
  const state = await loadMigrationState(args.groupId)
  const destinationCurrencyCode = args.destinationCurrencyCode
    .trim()
    .toUpperCase()
  const eligibility = getMigrationEligibility({
    oldLedgerCurrency: state.group.ledger.currencyCode,
    destinationCurrency: destinationCurrencyCode,
    expenses: state.expenses,
  })
  const destinationDiffers =
    destinationCurrencyCode !==
    (state.group.ledger.currencyCode ?? '').toUpperCase()
  const effectiveExpenses = state.expenses.map((expense) => ({
    id: expense.id,
    date: expense.expenseDate.toISOString().slice(0, 10),
    base:
      expense.originalAmount != null && expense.originalCurrency
        ? expense.originalCurrency.trim().toUpperCase()
        : (state.group.ledger.currencyCode ?? '').trim().toUpperCase(),
    amount:
      expense.originalAmount != null && expense.originalCurrency
        ? expense.originalAmount
        : expense.amount,
  }))
  return {
    groupId: args.groupId,
    oldCurrencyCode: state.group.ledger.currencyCode,
    destinationCurrencyCode,
    hasExpenses: state.expenses.length > 0,
    expenses: effectiveExpenses,
    ...eligibility,
    eligible: eligibility.eligible && destinationDiffers,
  }
}

function ensurePolicyCoverage(
  pairs: ReturnType<typeof getMigrationEligibility>['pairs'],
  choices: MigrationPairChoices,
) {
  const expected = new Set(pairs.map((pair) => `${pair.base}|${pair.target}`))
  for (const pair of pairs) {
    const key = `${pair.base}|${pair.target}`
    if (!choices[key]) {
      throw new CurrencyMigrationError(`Missing rate policy for ${key}`)
    }
  }
  for (const key of Object.keys(choices)) {
    if (!expected.has(key)) {
      throw new CurrencyMigrationError(`Unexpected rate policy for ${key}`)
    }
  }
}

function addRate(
  ratesByDate: Record<string, number>,
  date: string,
  base: string,
  target: string,
  rate: number,
) {
  ratesByDate[migrationRateKey(date, base, target)] = rate
}

async function resolveMigrationRates(args: {
  effective: EffectiveOriginalExpense[]
  destinationCurrency: string
  pairs: ReturnType<typeof getMigrationEligibility>['pairs']
  choices: MigrationPairChoices
}) {
  const requests: BatchRateRequest[] = []
  for (const pair of args.pairs) {
    const policy = args.choices[`${pair.base}|${pair.target}`]!
    if (policy.type === 'fixedCustom') continue
    const dates =
      policy.type === 'fixedProvider'
        ? [policy.date]
        : pair.dates.map((date) => exchangeRateLookupDate(date))
    for (const date of new Set(dates)) {
      requests.push({ date, base: pair.base, target: pair.target })
    }
  }

  const results = await getCurrencyRates(requests)
  const ratesByDate: Record<string, number> = {}
  let resultIndex = 0
  for (const pair of args.pairs) {
    const policy = args.choices[`${pair.base}|${pair.target}`]!
    if (policy.type === 'fixedCustom') continue
    if (policy.type === 'fixedProvider') {
      const result = results[resultIndex++]
      if (!result?.ok) throw providerFailure(result?.error)
      addRate(
        ratesByDate,
        policy.date,
        pair.base,
        pair.target,
        result.rate.rate,
      )
      continue
    }
    for (const date of new Set(
      pair.dates.map((d) => exchangeRateLookupDate(d)),
    )) {
      const result = results[resultIndex++]
      if (!result?.ok) throw providerFailure(result?.error)
      for (const expenseDate of pair.dates) {
        if (exchangeRateLookupDate(expenseDate) === date) {
          addRate(
            ratesByDate,
            expenseDate,
            pair.base,
            pair.target,
            result.rate.rate,
          )
        }
      }
    }
  }
  return ratesByDate
}

function providerFailure(
  error: { code: string; message?: string } | undefined,
) {
  if (error?.code === 'RATE_NOT_FOUND') {
    return new CurrencyMigrationError(
      `Currency rate was not found for ${error.code}`,
      'PROVIDER_UNAVAILABLE',
    )
  }
  return new CurrencyMigrationError(
    error?.message ?? 'Currency rate provider unavailable',
    'PROVIDER_UNAVAILABLE',
  )
}

function migrationInputFromState(expenses: StoredMigrationExpense[]) {
  return expenses.map((expense) => ({
    id: expense.id,
    expenseDate: expense.expenseDate,
    amount: expense.amount,
    originalAmount: expense.originalAmount,
    originalCurrency: expense.originalCurrency,
    conversionSource: expense.conversionSource,
  }))
}

export type MigrateGroupCurrencyInput = {
  groupId: string
  destinationCurrencyCode: string
  pairChoices: MigrationPairChoices
}

export async function migrateGroupCurrency(
  input: MigrateGroupCurrencyInput,
  actor: { accountId: string },
) {
  const state = await loadMigrationState(input.groupId)
  if (state.group.archived) {
    throw new CurrencyMigrationError(
      'This group is archived and cannot be migrated',
    )
  }
  const member = await prisma.groupMember.findUnique({
    where: {
      groupId_accountId: { groupId: input.groupId, accountId: actor.accountId },
    },
    select: { role: true, status: true },
  })
  if (
    !member ||
    member.status !== 'ACTIVE' ||
    member.role !== GroupRole.ADMIN
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only active group admins can migrate the group currency',
    })
  }
  if (state.expenses.length === 0) {
    throw new CurrencyMigrationError(
      'Groups without expenses do not need a currency migration',
    )
  }

  const destination = input.destinationCurrencyCode.trim().toUpperCase()
  if (!isSupportedMigrationCurrency(destination)) {
    throw new CurrencyMigrationError(
      `Unsupported destination currency: ${destination}`,
    )
  }
  if (destination === state.group.ledger.currencyCode) {
    throw new CurrencyMigrationError(
      'The destination currency must be different',
    )
  }
  const eligibility = getMigrationEligibility({
    oldLedgerCurrency: state.group.ledger.currencyCode,
    destinationCurrency: destination,
    expenses: migrationInputFromState(state.expenses),
  })
  if (!eligibility.eligible) {
    throw new CurrencyMigrationError(
      'The group contains unsupported currencies',
    )
  }
  ensurePolicyCoverage(eligibility.pairs, input.pairChoices)

  const ratesByDate = await resolveMigrationRates({
    effective: state.expenses.map((expense) =>
      // The eligibility helper applies the same effective-original rules.
      // Reuse its public result to keep preview and commit identical.
      ({
        id: expense.id,
        expenseDate: expense.expenseDate,
        effectiveOriginalAmount:
          expense.originalAmount != null && expense.originalCurrency
            ? expense.originalAmount
            : expense.amount,
        effectiveOriginalCurrency:
          expense.originalAmount != null && expense.originalCurrency
            ? expense.originalCurrency.toUpperCase()
            : state.group.ledger.currencyCode!.toUpperCase(),
        existingConversionSource: expense.conversionSource,
      }),
    ),
    destinationCurrency: destination,
    pairs: eligibility.pairs,
    choices: input.pairChoices,
  })

  const rewrites = state.expenses.map((expense) => {
    const effective: EffectiveOriginalExpense = {
      id: expense.id,
      expenseDate: expense.expenseDate,
      effectiveOriginalAmount:
        expense.originalAmount != null && expense.originalCurrency
          ? expense.originalAmount
          : expense.amount,
      effectiveOriginalCurrency:
        expense.originalAmount != null && expense.originalCurrency
          ? expense.originalCurrency.toUpperCase()
          : state.group.ledger.currencyCode!.toUpperCase(),
      existingConversionSource: expense.conversionSource,
    }
    const pair = eligibility.pairs.find(
      (candidate) =>
        candidate.base === effective.effectiveOriginalCurrency &&
        candidate.target === destination,
    )
    const policy = pair
      ? input.pairChoices[`${pair.base}|${pair.target}`]!
      : ({ type: 'perDate' } as const)
    return {
      id: expense.id,
      rewrite: calculateMigrationRewrite({
        expense: effective,
        oldLedgerCurrency: state.group.ledger.currencyCode!,
        destinationCurrency: destination,
        policy,
        ratesByDate,
      }),
    }
  })

  const result = await prisma.$transaction(async (tx) => {
    await tx.ledger.update({
      where: { id: state.group.ledgerId },
      data: {
        currencyCode: destination,
        currency: getCurrency(destination)?.symbol ?? destination,
      },
    })
    for (const item of rewrites) {
      await tx.expense.update({
        where: { id: item.id },
        data: item.rewrite,
      })
    }
    const activity = await logActivity(
      input.groupId,
      {
        type: 'GROUP_CURRENCY_MIGRATED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'GROUP', id: input.groupId },
        data: buildGroupActivityData({
          summary: `Currency changed from ${state.group.ledger.currencyCode} to ${destination}`,
          oldCurrencyCode: state.group.ledger.currencyCode ?? undefined,
          newCurrencyCode: destination,
        }),
      },
      tx,
    )
    return { activityId: activity.id }
  })
  return {
    groupId: input.groupId,
    oldCurrencyCode: state.group.ledger.currencyCode,
    newCurrencyCode: destination,
    migratedExpenses: rewrites.length,
    activityId: result.activityId,
  }
}
