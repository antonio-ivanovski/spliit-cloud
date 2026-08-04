import { createHash, randomUUID } from 'node:crypto'

import { EncryptJWT, jwtDecrypt } from 'jose'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import {
  categoryIdSchema,
  calculateExactShares,
  computeExactSharesFromItems,
  computePaidForFromItems,
  DEFAULT_CATEGORY_ID,
  distributeRemainder,
  expenseApiSchema,
  getCategoryById,
  getCurrency,
  isValidDisplayShare,
  sharesAsFixedUnits,
  type ExactAmount,
  type Expense,
} from '@spliit/domain'

import { env } from '../env'
import {
  resolveConversion,
  type ConversionResolution,
} from '../expense-conversion'
import { resolveParticipantDisplayName } from '../invitations'

const decimalString = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Use a positive decimal string')

const allocationSchema = z.object({
  participantId: z.string().min(1),
  amount: decimalString,
})

const splitSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('EVENLY'),
    participantIds: z.array(z.string().min(1)).min(1).optional(),
  }),
  z.object({
    mode: z.literal('BY_SHARES'),
    shares: z
      .array(
        z.object({
          participantId: z.string().min(1),
          // Display share with at most two decimal places (e.g. 0.5,
          // 1.1, 25.75). `normalizeSplit` converts it to the internal
          // fixed-unit form before the value reaches the expense payload.
          shares: z
            .number()
            .positive()
            .refine(isValidDisplayShare, {
              message:
                'BY_SHARES value must be a positive decimal with at most two places (0.01–1,000,000)',
            })
            .describe(
              'Share weight. Decimals are allowed with up to two places, e.g. 0.5, 1.1, 25.75 (not hundredths).',
            ),
        }),
      )
      .min(1),
  }),
  z.object({
    mode: z.literal('BY_PERCENTAGE'),
    shares: z
      .array(
        z.object({
          participantId: z.string().min(1),
          percentage: decimalString,
        }),
      )
      .min(1),
  }),
  z.object({
    mode: z.literal('BY_AMOUNT'),
    shares: z.array(allocationSchema).min(1),
  }),
])

const itemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  unitPrice: decimalString,
  quantity: z.number().int().positive().default(1),
  split: splitSchema.optional(),
})

export const prepareExpenseInputSchema = z
  .object({
    groupId: z.string().min(1),
    amount: decimalString,
    title: z.string().trim().min(2).max(120),
    date: z.iso.date().optional(),
    category: categoryIdSchema.optional(),
    notes: z.string().max(10_000).optional(),
    currencyCode: z.string().min(3).max(4).optional(),
    paidBy: z.array(allocationSchema).min(1).optional(),
    split: splitSchema.optional(),
    items: z.array(itemSchema).min(1).max(100).optional(),
    remainderSplit: splitSchema.optional(),
    timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.items && input.split) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Use item splits instead of a flat split for itemized expenses',
        path: ['split'],
      })
    }
    if (!input.items && input.remainderSplit) {
      ctx.addIssue({
        code: 'custom',
        message: 'A remainder split requires itemized expense items',
        path: ['remainderSplit'],
      })
    }
  })

export type PrepareExpenseInput = z.infer<typeof prepareExpenseInputSchema>

export class AssistantExpenseInputError extends Error {
  override name = 'AssistantExpenseInputError'
}

function inputError(message: string): never {
  throw new AssistantExpenseInputError(message)
}

export function decimalToMinorUnits(value: string, decimalDigits: number) {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim())
  if (!match) inputError('Invalid decimal amount')
  const fraction = match[2] ?? ''
  if (fraction.length > decimalDigits) {
    inputError(
      `Amount has more than ${decimalDigits} decimal places for this currency`,
    )
  }
  const scale = 10 ** decimalDigits
  const result =
    Number(match[1]) * scale +
    Number(fraction.padEnd(decimalDigits, '0') || '0')
  if (!Number.isSafeInteger(result)) inputError('Amount is too large')
  return result
}

export function localDateFromOffset(
  now: Date,
  timezoneOffsetMinutes = 0,
): Date {
  const local = new Date(now.getTime() + timezoneOffsetMinutes * 60_000)
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  )
}

function tokenKey() {
  const secret =
    env.ASSISTANT_CONFIRMATION_SECRET ??
    'spliit-assistant-development-secret-change-me'
  return createHash('sha256').update(secret).digest()
}

type ConfirmationClaims = {
  accountId: string
  groupId: string
  ledgerCurrencyCode: string | null
  requestId: string
  expense: Expense
  conversion: ConversionResolution
}

export async function sealConfirmation(claims: ConfirmationClaims) {
  return new EncryptJWT({
    accountId: claims.accountId,
    groupId: claims.groupId,
    ledgerCurrencyCode: claims.ledgerCurrencyCode,
    requestId: claims.requestId,
    conversion: claims.conversion,
    expense: {
      ...claims.expense,
      expenseDate: claims.expense.expenseDate.toISOString(),
    },
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .encrypt(tokenKey())
}

export async function openConfirmation(
  token: string,
): Promise<ConfirmationClaims> {
  const { payload } = await jwtDecrypt(token, tokenKey(), {
    clockTolerance: 5,
  })
  const parsed = z
    .object({
      accountId: z.string(),
      groupId: z.string(),
      ledgerCurrencyCode: z.string().nullable(),
      requestId: z.string().uuid(),
      expense: expenseApiSchema,
      conversion: z.object({
        conversionSource: z.enum(['EXCHANGE', 'CUSTOM']).nullable(),
        conversionRate: z.number().positive().nullable(),
        originalAmount: z.number().int().nullable(),
        originalCurrency: z.string().nullable(),
        ledgerAmountMinor: z.number().int(),
        inputAmountMinor: z.number().int(),
      }),
    })
    .parse(payload)
  return parsed
}

export async function getAssistantGroup(groupId: string, accountId: string) {
  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId } },
    include: {
      ledgerParticipant: true,
      group: {
        include: {
          ledger: {
            include: {
              participants: {
                where: {
                  removedAt: null,
                  OR: [
                    { groupMember: { status: 'ACTIVE' } },
                    { invitations: { some: { status: 'PENDING' } } },
                    { kind: 'UNLINKED_PARTICIPANT' },
                  ],
                },
                include: {
                  groupMember: { include: { account: true } },
                  invitations: {
                    where: { status: 'PENDING' },
                    take: 1,
                  },
                },
              },
            },
          },
          members: {
            where: { status: 'ACTIVE' },
            include: { account: true },
          },
        },
      },
    },
  })
  if (!member || member.status !== 'ACTIVE') {
    inputError('You are not an active member of this group')
  }
  if (member.group.archived) inputError('This group is archived')
  return member
}

function participantName(
  participant: Awaited<
    ReturnType<typeof getAssistantGroup>
  >['group']['ledger']['participants'][number],
) {
  return resolveParticipantDisplayName(participant) || 'Pending participant'
}

function ensureUniqueParticipantIds(rows: Array<{ participant: string }>) {
  const ids = rows.map((row) => row.participant)
  if (new Set(ids).size !== ids.length) {
    inputError('A participant may only appear once in an allocation')
  }
}

type AssistantSplitInput = z.infer<typeof splitSchema>
type FlatSplitMode = Exclude<Expense['splitMode'], 'ITEMIZED'>
type NormalizedSplit = {
  splitMode: FlatSplitMode
  paidFor: Expense['paidFor']
}
type SavedDefault = {
  splitMode: FlatSplitMode | 'ITEMIZED'
  paidFor: Array<{ participantId: string; shares: number }>
} | null

function normalizeSplit(
  split: AssistantSplitInput,
  amount: number,
  decimalDigits: number,
  participantIds: string[],
): NormalizedSplit {
  let normalized: NormalizedSplit
  if (split.mode === 'EVENLY') {
    normalized = {
      splitMode: 'EVENLY',
      paidFor: (split.participantIds ?? participantIds).map((participant) => ({
        participant,
        shares: 1,
      })),
    }
  } else if (split.mode === 'BY_SHARES') {
    normalized = {
      splitMode: 'BY_SHARES',
      paidFor: split.shares.map((row) => ({
        participant: row.participantId,
        shares: sharesAsFixedUnits(row.shares),
      })),
    }
  } else if (split.mode === 'BY_PERCENTAGE') {
    normalized = {
      splitMode: 'BY_PERCENTAGE',
      paidFor: split.shares.map((row) => ({
        participant: row.participantId,
        shares: decimalToMinorUnits(row.percentage, 2),
      })),
    }
  } else {
    normalized = {
      splitMode: 'BY_AMOUNT',
      paidFor: split.shares.map((row) => ({
        participant: row.participantId,
        shares: decimalToMinorUnits(row.amount, decimalDigits),
      })),
    }
  }
  ensureUniqueParticipantIds(normalized.paidFor)
  const allowed = new Set(participantIds)
  for (const row of normalized.paidFor) {
    if (!allowed.has(row.participant)) {
      inputError(`Unknown or stale participant ID: ${row.participant}`)
    }
  }
  if (
    normalized.splitMode === 'BY_AMOUNT' &&
    normalized.paidFor.reduce((sum, row) => sum + row.shares, 0) !== amount
  ) {
    inputError('Exact split amounts must total the target amount')
  }
  if (
    normalized.splitMode === 'BY_PERCENTAGE' &&
    normalized.paidFor.reduce((sum, row) => sum + row.shares, 0) !== 10_000
  ) {
    inputError('Percentage split values must total 100')
  }
  return normalized
}

function normalizeSavedDefault(
  saved: SavedDefault,
  amount: number,
  participantIds: string[],
  scaleExactAmounts: boolean,
): NormalizedSplit | null {
  if (!saved || saved.splitMode === 'ITEMIZED' || !saved.paidFor.length) {
    return null
  }
  const allowed = new Set(participantIds)
  if (
    saved.paidFor.some(
      (row) => row.shares <= 0 || !allowed.has(row.participantId),
    )
  ) {
    return null
  }
  const total = saved.paidFor.reduce((sum, row) => sum + row.shares, 0)
  if (saved.splitMode === 'BY_PERCENTAGE' && total !== 10_000) return null
  if (saved.splitMode === 'BY_AMOUNT') {
    if (!scaleExactAmounts && total !== amount) return null
    if (scaleExactAmounts) {
      const exact = calculateExactShares({
        amount,
        splitMode: 'BY_SHARES',
        participants: saved.paidFor.map((row) => ({
          id: row.participantId,
          shares: row.shares,
        })),
      })
      const scaled = distributeRemainder(exact, amount, {
        strategy: 'PARTICIPANT_ID_DESC',
      })
      return {
        splitMode: 'BY_AMOUNT',
        paidFor: Object.entries(scaled)
          .filter(([, shares]) => shares > 0)
          .map(([participant, shares]) => ({ participant, shares })),
      }
    }
  }
  return {
    splitMode: saved.splitMode,
    paidFor: saved.paidFor.map((row) => ({
      participant: row.participantId,
      shares: row.shares,
    })),
  }
}

function proportionalRemainder(
  items: NonNullable<Expense['items']>,
  participantIds: string[],
  itemsTotal: number,
  remainderAmount: number,
): NonNullable<Expense['itemizedRemainder']> {
  const itemShares = computeExactSharesFromItems(
    items,
    participantIds,
    itemsTotal,
  )
  const proportional: Record<string, ExactAmount> = {}
  for (const [participantId, share] of Object.entries(itemShares)) {
    proportional[participantId] = {
      numerator: share.numerator * BigInt(remainderAmount),
      denominator: share.denominator * BigInt(itemsTotal),
    }
  }
  const amounts = distributeRemainder(proportional, remainderAmount, {
    strategy: 'PARTICIPANT_ID_DESC',
  })
  return {
    splitMode: 'BY_AMOUNT',
    paidFor: Object.entries(amounts)
      .filter(([, shares]) => shares > 0)
      .map(([participant, shares]) => ({ participant, shares })),
  }
}

export async function prepareAssistantExpense(
  rawInput: PrepareExpenseInput,
  accountId: string,
  options: {
    now?: Date
    resolveConversion?: typeof resolveConversion
  } = {},
) {
  const input = prepareExpenseInputSchema.parse(rawInput)
  const member = await getAssistantGroup(input.groupId, accountId)
  const { group } = member
  const groupCurrencyCode = group.ledger.currencyCode?.toUpperCase() ?? null
  const expenseCurrencyCode =
    input.currencyCode?.toUpperCase() ?? groupCurrencyCode
  const expenseCurrency = expenseCurrencyCode
    ? getCurrency(expenseCurrencyCode)
    : null
  if (expenseCurrencyCode && !expenseCurrency) {
    inputError(`Unsupported currency code: ${expenseCurrencyCode}`)
  }
  if (
    input.currencyCode &&
    (!groupCurrencyCode || !expenseCurrencyCode) &&
    input.currencyCode !== groupCurrencyCode
  ) {
    inputError('Foreign-currency expenses require an ISO currency on the group')
  }
  const decimalDigits = expenseCurrency?.decimal_digits ?? 2

  const amount = decimalToMinorUnits(input.amount, decimalDigits)
  if (amount <= 0) inputError('Amount must be greater than zero')
  const participantMap = new Map(
    group.ledger.participants.map((participant) => [
      participant.id,
      participant,
    ]),
  )
  const participantIds = [...participantMap.keys()]
  const assertParticipants = (ids: string[]) => {
    for (const id of ids) {
      if (!participantMap.has(id)) {
        inputError(`Unknown or stale participant ID: ${id}`)
      }
    }
  }

  const defaulted: Array<{ field: string; label: string; value: string }> = []
  const addDefault = (field: string, label: string, value: string) => {
    if (!defaulted.some((item) => item.field === field)) {
      defaulted.push({ field, label, value })
    }
  }
  let paidByList: Expense['paidByList']
  if (input.paidBy) {
    paidByList = input.paidBy.map((row) => ({
      participant: row.participantId,
      shares: decimalToMinorUnits(row.amount, decimalDigits),
    }))
  } else {
    if (!member.ledgerParticipant) {
      inputError('Your group participant is not available')
    }
    paidByList = [{ participant: member.ledgerParticipant.id, shares: amount }]
    addDefault('payer', 'Payer', 'You')
  }
  ensureUniqueParticipantIds(paidByList)
  assertParticipants(paidByList.map((row) => row.participant))

  const needsSavedDefault = input.items
    ? input.items.some((item) => !item.split)
    : !input.split
  const saved = needsSavedDefault
    ? await prisma.accountGroupDefaultSplit.findUnique({
        where: {
          accountId_groupId: { accountId, groupId: group.id },
        },
        include: { paidFor: true },
      })
    : null
  const savedDefault: SavedDefault = saved
    ? {
        splitMode: saved.splitMode,
        paidFor: saved.paidFor,
      }
    : null

  let splitMode: Expense['splitMode']
  let paidFor: Expense['paidFor']
  let items: Expense['items']
  let itemizedRemainder: Expense['itemizedRemainder']
  let remainderAmount = 0
  if (input.items) {
    splitMode = 'ITEMIZED'
    items = input.items.map((item) => {
      const unitPrice = decimalToMinorUnits(item.unitPrice, decimalDigits)
      if (unitPrice <= 0) {
        inputError(`Item unit price must be greater than zero: ${item.title}`)
      }
      const itemAmount = unitPrice * item.quantity
      if (!Number.isSafeInteger(itemAmount)) {
        inputError(`Item amount is too large: ${item.title}`)
      }
      const defaultSplit = item.split
        ? null
        : normalizeSavedDefault(savedDefault, itemAmount, participantIds, true)
      const normalized = (item.split
        ? normalizeSplit(item.split, itemAmount, decimalDigits, participantIds)
        : defaultSplit) ?? {
        splitMode: 'EVENLY' as const,
        paidFor: participantIds.map((participant) => ({
          participant,
          shares: 1,
        })),
      }
      if (!item.split) {
        addDefault(
          'item-splits',
          'Item splits',
          defaultSplit
            ? 'Your saved group split'
            : 'Evenly across current participants',
        )
      }
      return {
        title: item.title,
        unitPrice,
        quantity: item.quantity,
        amount: itemAmount,
        splitMode: normalized.splitMode,
        paidFor: normalized.paidFor,
      }
    })
    const itemsTotal = items.reduce((sum, item) => sum + item.amount, 0)
    if (itemsTotal > amount) {
      inputError('Item totals cannot exceed the expense total')
    }
    remainderAmount = amount - itemsTotal
    if (input.remainderSplit && remainderAmount === 0) {
      inputError('A remainder split was supplied, but there is no remainder')
    }
    if (remainderAmount > 0) {
      if (input.remainderSplit) {
        const normalized = normalizeSplit(
          input.remainderSplit,
          remainderAmount,
          decimalDigits,
          participantIds,
        )
        itemizedRemainder = {
          splitMode: normalized.splitMode,
          paidFor: normalized.paidFor,
        }
      } else {
        itemizedRemainder = proportionalRemainder(
          items,
          participantIds,
          itemsTotal,
          remainderAmount,
        )
        addDefault(
          'remainder',
          'Tax, tip and remainder',
          'Proportional to item subtotals',
        )
      }
    }
    paidFor = computePaidForFromItems(
      items,
      participantIds,
      amount,
      itemizedRemainder,
    ).paidFor
  } else if (input.split) {
    const normalized = normalizeSplit(
      input.split,
      amount,
      decimalDigits,
      participantIds,
    )
    splitMode = normalized.splitMode
    paidFor = normalized.paidFor
  } else {
    const defaultSplit = normalizeSavedDefault(
      savedDefault,
      amount,
      participantIds,
      false,
    )
    if (defaultSplit) {
      splitMode = defaultSplit.splitMode
      paidFor = defaultSplit.paidFor
      addDefault('split', 'Split', 'Your saved group default')
    } else {
      splitMode = 'EVENLY'
      paidFor = participantIds.map((participant) => ({
        participant,
        shares: 1,
      }))
      addDefault('split', 'Split', 'Evenly across current participants')
    }
  }
  ensureUniqueParticipantIds(paidFor)
  assertParticipants(paidFor.map((row) => row.participant))

  const expense = expenseApiSchema.parse({
    expenseDate: input.date
      ? new Date(`${input.date}T00:00:00.000Z`)
      : localDateFromOffset(
          options.now ?? new Date(),
          input.timezoneOffsetMinutes,
        ),
    title: input.title,
    category: input.category ?? DEFAULT_CATEGORY_ID,
    amount,
    paidBySplitMode: 'BY_AMOUNT',
    paidByList,
    isMultiPayer: paidByList.length > 1,
    splitMode,
    paidFor,
    isReimbursement: false,
    documents: [],
    notes: input.notes,
    recurrenceRule: 'NONE',
    recurrence: null,
    items,
    itemizedRemainder,
    conversion:
      expenseCurrencyCode && expenseCurrencyCode !== groupCurrencyCode
        ? { type: 'exchange', currency: expenseCurrencyCode }
        : undefined,
  })
  const conversion = await (options.resolveConversion ?? resolveConversion)(
    expense,
    {
      ledgerCurrency: groupCurrencyCode,
      expenseDate: expense.expenseDate,
    },
  )
  if (!input.date) addDefault('date', 'Date', 'Today')
  if (!input.category) addDefault('category', 'Category', 'General')
  if (conversion.conversionSource === 'EXCHANGE') {
    addDefault(
      'exchange-rate',
      'Exchange rate',
      'Spliit rate for the expense date',
    )
  }

  const nameById = (id: string) => participantName(participantMap.get(id)!)
  const groupCurrency = groupCurrencyCode
    ? getCurrency(groupCurrencyCode)
    : null
  const preview = {
    group: {
      id: group.id,
      name:
        group.name ||
        group.members.find((row) => row.accountId !== accountId)?.account
          .name ||
        'Friend',
      currency: group.ledger.currency,
      currencyCode: groupCurrencyCode,
      decimalDigits: groupCurrency?.decimal_digits ?? 2,
    },
    expenseCurrency: {
      code: expenseCurrencyCode,
      symbol: expenseCurrency?.symbol ?? group.ledger.currency,
      decimalDigits,
    },
    title: expense.title,
    amountMinor: expense.amount,
    amount: input.amount,
    date: expense.expenseDate.toISOString().slice(0, 10),
    category: getCategoryById(expense.category)?.name ?? 'General',
    notes: expense.notes ?? null,
    paidBy: expense.paidByList.map((row) => ({
      participantId: row.participant,
      name: nameById(row.participant),
      shares: row.shares,
    })),
    split: {
      mode: expense.splitMode,
      participants: expense.paidFor.map((row) => ({
        participantId: row.participant,
        name: nameById(row.participant),
        shares: row.shares,
      })),
    },
    items: (expense.items ?? []).map((item, index) => ({
      lineId: `item-${index + 1}`,
      title: item.title,
      unitPriceMinor: item.unitPrice,
      quantity: item.quantity,
      amountMinor: item.amount,
      split: {
        mode: item.splitMode,
        participants: item.paidFor.map((row) => ({
          participantId: row.participant,
          name: nameById(row.participant),
          shares: row.shares,
        })),
      },
    })),
    remainder:
      remainderAmount > 0 && expense.itemizedRemainder
        ? {
            amountMinor: remainderAmount,
            split: {
              mode: expense.itemizedRemainder.splitMode,
              participants: expense.itemizedRemainder.paidFor.map((row) => ({
                participantId: row.participant,
                name: nameById(row.participant),
                shares: row.shares,
              })),
            },
          }
        : null,
    conversion:
      conversion.conversionSource === 'EXCHANGE'
        ? {
            ledgerAmountMinor: conversion.ledgerAmountMinor,
            ledgerCurrencyCode: groupCurrencyCode,
            ledgerCurrencySymbol: group.ledger.currency,
            ledgerDecimalDigits: groupCurrency?.decimal_digits ?? 2,
            rate: conversion.conversionRate,
          }
        : null,
    defaults: defaulted,
  }
  const requestId = randomUUID()
  const confirmationToken = await sealConfirmation({
    accountId,
    groupId: group.id,
    ledgerCurrencyCode: groupCurrencyCode,
    requestId,
    expense,
    conversion,
  })
  return { preview, expense, requestId, confirmationToken }
}
