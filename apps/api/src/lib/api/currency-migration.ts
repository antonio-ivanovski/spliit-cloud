import { GroupRole, prisma, type Prisma } from '@spliit/db'
import {
  calculateMigrationRewrite,
  classifyMigrationExpenses,
  exchangeRateLookupDate,
  getCurrency,
  getMigrationEligibility,
  isSupportedMigrationCurrency,
  migrationPairPolicySchema,
  migrationRateKey,
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

function normalizeCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase()
}

type StoredMigrationExpense = MigrationExpenseInput & {
  expenseDate: Date
  conversionSource: 'EXCHANGE' | 'CUSTOM' | null
}

type MigrationGroupInfo = {
  id: string
  ledgerId: string
  archived: boolean
  currencyCode: string | null
}

async function loadMigrationGroup(
  groupId: string,
): Promise<MigrationGroupInfo> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      ledgerId: true,
      archived: true,
      ledger: { select: { currencyCode: true } },
    },
  })
  if (!group) throw new CurrencyMigrationError('Group not found', 'NOT_FOUND')
  return {
    id: group.id,
    ledgerId: group.ledgerId,
    archived: group.archived,
    currencyCode: group.ledger.currencyCode,
  }
}

function selectExpenseFields() {
  return {
    id: true,
    expenseDate: true,
    amount: true,
    originalAmount: true,
    originalCurrency: true,
    conversionSource: true,
  } as const
}

function loadMigrationExpenses(
  client: Pick<Prisma.TransactionClient, 'expense'> | typeof prisma,
  ledgerId: string,
) {
  return client.expense.findMany({
    where: { ledgerId },
    select: selectExpenseFields(),
    orderBy: { id: 'asc' },
  })
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

/**
 * Build a preview of a currency migration for a group. The caller (a tRPC
 * procedure) is expected to have already loaded the group's ledger — pass it
 * via {@link args.ledger} so we don't re-read the group just to fetch the
 * ledger id and current currency code. When {@link args.ledger} is omitted
 * the group is loaded from the database, which is convenient for direct
 * callers (tests, scripts).
 */
export async function getCurrencyMigrationPreview(args: {
  groupId: string
  destinationCurrencyCode: string
  ledger?: { id: string; currencyCode: string | null }
}): Promise<CurrencyMigrationPreview> {
  const ledgerId = args.ledger?.id
  const oldCurrencyCode = args.ledger?.currencyCode ?? null
  if (!ledgerId) {
    const group = await loadMigrationGroup(args.groupId)
    return getCurrencyMigrationPreview({
      groupId: args.groupId,
      destinationCurrencyCode: args.destinationCurrencyCode,
      ledger: { id: group.ledgerId, currencyCode: group.currencyCode },
    })
  }

  const destinationCurrencyCode = normalizeCode(args.destinationCurrencyCode)
  const expenses = await loadMigrationExpenses(prisma, ledgerId)
  const migrationInputs = migrationInputFromExpenses(expenses)
  const eligibility = getMigrationEligibility({
    oldLedgerCurrency: oldCurrencyCode,
    destinationCurrency: destinationCurrencyCode,
    expenses: migrationInputs,
  })
  const normalizedOldCurrency = normalizeCode(oldCurrencyCode)
  const destinationDiffers = destinationCurrencyCode !== normalizedOldCurrency
  const effectiveExpenses = classifyMigrationExpenses(
    migrationInputs,
    normalizedOldCurrency,
  ).map((eff) => ({
    id: eff.id,
    date:
      eff.expenseDate instanceof Date
        ? eff.expenseDate.toISOString().slice(0, 10)
        : String(eff.expenseDate).slice(0, 10),
    base: eff.effectiveOriginalCurrency,
    amount: eff.effectiveOriginalAmount,
  }))
  return {
    groupId: args.groupId,
    oldCurrencyCode,
    destinationCurrencyCode,
    hasExpenses: expenses.length > 0,
    expenses: effectiveExpenses,
    ...eligibility,
    eligible: expenses.length > 0 && eligibility.eligible && destinationDiffers,
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

type RateRequestMeta = {
  base: string
  target: string
  expenseDates: string[]
}

async function resolveMigrationRates(args: {
  destinationCurrency: string
  pairs: ReturnType<typeof getMigrationEligibility>['pairs']
  choices: MigrationPairChoices
}): Promise<Map<string, number>> {
  // Build the rate requests alongside a parallel `requestMeta` so each
  // upstream result is unambiguously paired with the expense dates it
  // applies to. Iterating by shared index avoids the manual
  // `resultIndex++` counter, which would silently misalign if request
  // ordering or dedup ever changes.
  const requests: BatchRateRequest[] = []
  const requestMeta: RateRequestMeta[] = []
  for (const pair of args.pairs) {
    const policy = args.choices[`${pair.base}|${pair.target}`]!
    if (policy.type === 'fixedCustom') continue

    if (policy.type === 'fixedProvider') {
      requests.push({
        date: policy.date,
        base: pair.base,
        target: pair.target,
      })
      requestMeta.push({
        base: pair.base,
        target: pair.target,
        expenseDates: [policy.date],
      })
      continue
    }

    // perDate: collapse lookup dates so each (date, base, target) hits the
    // upstream provider at most once, but remember every expense date that
    // resolves to that lookup so the rate is recorded under each.
    const expenseDatesByLookupDate = new Map<string, string[]>()
    for (const expenseDate of pair.dates) {
      const lookupDate = exchangeRateLookupDate(expenseDate)
      const list = expenseDatesByLookupDate.get(lookupDate) ?? []
      list.push(expenseDate)
      expenseDatesByLookupDate.set(lookupDate, list)
    }
    for (const [lookupDate, expenseDates] of expenseDatesByLookupDate) {
      requests.push({
        date: lookupDate,
        base: pair.base,
        target: pair.target,
      })
      requestMeta.push({
        base: pair.base,
        target: pair.target,
        expenseDates,
      })
    }
  }

  const results = await getCurrencyRates(requests)
  const ratesByDate = new Map<string, number>()
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const meta = requestMeta[i]
    if (!result?.ok) throw providerFailure(result?.error)
    for (const expenseDate of meta.expenseDates) {
      ratesByDate.set(
        migrationRateKey(expenseDate, meta.base, meta.target),
        result.rate.rate,
      )
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

function migrationInputFromExpenses(expenses: StoredMigrationExpense[]) {
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
  // Precondition reads — cheap and stable enough to leave outside the
  // transaction. The expense list, eligibility, rate resolution, and all
  // writes happen inside the transaction so the rewrite values reflect a
  // consistent snapshot of the ledger at commit time.
  const group = await loadMigrationGroup(input.groupId)
  if (group.archived) {
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

  const destination = normalizeCode(input.destinationCurrencyCode)
  if (!isSupportedMigrationCurrency(destination)) {
    throw new CurrencyMigrationError(
      `Unsupported destination currency: ${destination}`,
    )
  }
  const oldCurrency = normalizeCode(group.currencyCode)
  if (destination === oldCurrency) {
    throw new CurrencyMigrationError(
      'The destination currency must be different',
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    const expenses = await loadMigrationExpenses(tx, group.ledgerId)
    if (expenses.length === 0) {
      throw new CurrencyMigrationError(
        'Groups without expenses do not need a currency migration',
      )
    }

    const eligibility = getMigrationEligibility({
      oldLedgerCurrency: group.currencyCode,
      destinationCurrency: destination,
      expenses: migrationInputFromExpenses(expenses),
    })
    if (!eligibility.eligible) {
      throw new CurrencyMigrationError(
        'The group contains unsupported currencies',
      )
    }
    ensurePolicyCoverage(eligibility.pairs, input.pairChoices)

    const effective = classifyMigrationExpenses(
      migrationInputFromExpenses(expenses),
      oldCurrency,
    )
    const ratesByDate = await resolveMigrationRates({
      destinationCurrency: destination,
      pairs: eligibility.pairs,
      choices: input.pairChoices,
    })
    const ratesByDateRecord = Object.fromEntries(ratesByDate)

    const rewrites = effective.map((effectiveExpense) => {
      const pair = eligibility.pairs.find(
        (candidate) =>
          candidate.base === effectiveExpense.effectiveOriginalCurrency &&
          candidate.target === destination,
      )
      const policy = pair
        ? input.pairChoices[`${pair.base}|${pair.target}`]!
        : ({ type: 'perDate' } as const)
      return {
        id: effectiveExpense.id,
        rewrite: calculateMigrationRewrite({
          expense: effectiveExpense,
          oldLedgerCurrency: oldCurrency,
          destinationCurrency: destination,
          policy,
          ratesByDate: ratesByDateRecord,
        }),
      }
    })

    await tx.ledger.update({
      where: { id: group.ledgerId },
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
          summary: `Currency changed from ${group.currencyCode} to ${destination}`,
          oldCurrencyCode: group.currencyCode ?? undefined,
          newCurrencyCode: destination,
        }),
      },
      tx,
    )
    return { activityId: activity.id, migratedExpenses: rewrites.length }
  })

  return {
    groupId: input.groupId,
    oldCurrencyCode: group.currencyCode,
    newCurrencyCode: destination,
    migratedExpenses: result.migratedExpenses,
    activityId: result.activityId,
  }
}
