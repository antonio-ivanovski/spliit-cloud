import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { GroupMemberStatus, prisma, type Prisma } from '@spliit/db'
import {
  SETTLEMENT_CATEGORY_ID,
  expandCategorySelection,
  loadLocaleDictionary,
} from '@spliit/domain'

import {
  mapExpenseListRow,
  type ExpenseListDbRow,
} from '../../../lib/api/expenses/queries'
import {
  expenseTextSearchOr,
  findSimilarExpenseTitleIds,
  mergeWhereAnd,
} from '../../../lib/api/expenses/title-search'
import { groupExpenseListCardSelect } from '../../../lib/api/selects/expense-list'
import { resolveParticipantDisplayName } from '../../../lib/invitations/display'
import { createTRPCRouter, protectedProcedure } from '../../init'
import {
  globalExpensesFilterOptionsOutputSchema,
  globalExpensesListOutputSchema,
} from '../../outputs/global-expenses'

const personRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), id: z.string().min(1) }),
  z.object({
    kind: z.literal('participant'),
    id: z.string().min(1),
    groupId: z.string().min(1),
  }),
])

const matchModeSchema = z.enum(['any', 'all', 'exact']).default('any')
const sortBySchema = z.enum(['expenseDate', 'createdAt', 'amount'])
const sortDirSchema = z.enum(['asc', 'desc'])

const globalExpensesInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
  query: z.string().optional(),
  locale: z.string().optional(),
  groupIds: z.array(z.string().min(1)).optional(),
  hideSettlements: z.boolean().default(false),
  categories: z.array(z.string()).optional(),
  paidBy: z.array(personRefSchema).optional(),
  paidByMatch: matchModeSchema,
  paidFor: z.array(personRefSchema).optional(),
  paidForMatch: matchModeSchema,
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  minAmount: z.number().int().optional(),
  maxAmount: z.number().int().optional(),
  currencies: z.array(z.string()).optional(),
  sortBy: sortBySchema.default('expenseDate'),
  sortDir: sortDirSchema.default('desc'),
})

type GlobalExpensesInput = z.infer<typeof globalExpensesInputSchema>
type PersonRef = z.infer<typeof personRefSchema>
type SortBy = z.infer<typeof sortBySchema>
type SortDir = z.infer<typeof sortDirSchema>

const globalExpenseSelect = {
  ...groupExpenseListCardSelect,
  ledgerId: true,
} satisfies Prisma.ExpenseSelect

type GroupContext = {
  id: string
  name: string
  archived: boolean
  hidden: boolean
  groupType: 'GROUP' | 'FRIEND'
  displayName: string
  ledgerId: string
  currency: string
  currencyCode: string | null
  participantCount: number
}

function currencyKey(currency: string, currencyCode: string | null) {
  return `${currencyCode ?? ''}:${currency}`
}

function encodeCursor(value: {
  sortBy: SortBy
  sortDir: SortDir
  value: string | number
  id: string
  createdAt?: string
}) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as {
      sortBy?: SortBy
      sortDir?: SortDir
      value?: string | number
      id?: string
      createdAt?: string
    }
    if (
      !parsed.sortBy ||
      !parsed.sortDir ||
      parsed.value === undefined ||
      !parsed.id
    )
      return null
    return parsed
  } catch {
    return null
  }
}

function cursorWhere(
  cursor: NonNullable<ReturnType<typeof decodeCursor>>,
): Prisma.ExpenseWhereInput {
  const direction = cursor.sortDir === 'desc' ? 'lt' : 'gt'
  const value =
    cursor.sortBy === 'amount'
      ? Number(cursor.value)
      : new Date(String(cursor.value))
  if (cursor.sortBy === 'expenseDate') {
    const createdAt = new Date(cursor.createdAt ?? String(cursor.value))
    return {
      OR: [
        { expenseDate: { [direction]: value } },
        {
          expenseDate: value,
          createdAt: { [direction]: createdAt },
        },
        {
          expenseDate: value,
          createdAt,
          id: { [direction]: cursor.id },
        },
      ],
    } as Prisma.ExpenseWhereInput
  }
  if (cursor.sortBy === 'createdAt') {
    return {
      OR: [
        { createdAt: { [direction]: value } },
        { createdAt: value, id: { [direction]: cursor.id } },
      ],
    } as Prisma.ExpenseWhereInput
  }
  return {
    OR: [
      { amount: { [direction]: value } },
      { amount: value, id: { [direction]: cursor.id } },
    ],
  } as Prisma.ExpenseWhereInput
}

function personIdentityCondition(person: PersonRef): Record<string, unknown> {
  if (person.kind === 'account') {
    return {
      ledgerParticipant: { groupMember: { accountId: person.id } },
    }
  }
  return { ledgerParticipantId: person.id }
}

function personRelationFilter(
  people: PersonRef[] | undefined,
  match: 'any' | 'all' | 'exact',
  relation: 'paidByList' | 'paidFor',
): Prisma.ExpenseWhereInput | undefined {
  if (!people || people.length === 0) return undefined
  const relations = people.map(
    (person) =>
      ({
        [relation]: { some: personIdentityCondition(person) },
      }) as Prisma.ExpenseWhereInput,
  )
  if (match === 'any') return { OR: relations }
  if (match === 'all') return { AND: relations }

  const selectedIdentity = {
    OR: people.map((person) => personIdentityCondition(person)),
  } as Prisma.ExpenseWhereInput
  return {
    AND: relations,
    NOT: {
      [relation]: { some: { NOT: selectedIdentity } },
    },
  } as Prisma.ExpenseWhereInput
}

export function composeGlobalPersonFilters(
  paidBy: PersonRef[] | undefined,
  paidByMatch: 'any' | 'all' | 'exact',
  paidFor: PersonRef[] | undefined,
  paidForMatch: 'any' | 'all' | 'exact',
) {
  const filters = [
    personRelationFilter(paidBy, paidByMatch, 'paidByList'),
    personRelationFilter(paidFor, paidForMatch, 'paidFor'),
  ].filter((filter): filter is Prisma.ExpenseWhereInput => filter !== undefined)
  return filters.length > 0 ? { AND: filters } : undefined
}

async function getGroupContexts(accountId: string): Promise<GroupContext[]> {
  const memberships = await prisma.groupMember.findMany({
    where: { accountId, status: GroupMemberStatus.ACTIVE },
    select: {
      group: {
        select: {
          id: true,
          name: true,
          archived: true,
          groupType: true,
          ledger: {
            select: {
              id: true,
              currency: true,
              currencyCode: true,
              _count: { select: { participants: true } },
            },
          },
          members: {
            where: { status: GroupMemberStatus.ACTIVE },
            select: { account: { select: { id: true, name: true } } },
          },
        },
      },
    },
  })
  const groupIds = memberships.map(({ group }) => group.id)
  const preferences = new Map(
    (groupIds.length === 0
      ? []
      : await prisma.accountGroupPreference.findMany({
          where: { accountId, groupId: { in: groupIds } },
          select: { groupId: true, hidden: true },
        })
    ).map((preference) => [preference.groupId, preference.hidden]),
  )

  return memberships.map(({ group }) => {
    const friend =
      group.groupType === 'FRIEND'
        ? (group.members.find((member) => member.account?.id !== accountId)
            ?.account?.name ?? group.name)
        : group.name
    return {
      id: group.id,
      name: group.name,
      archived: group.archived,
      hidden: preferences.get(group.id) ?? false,
      groupType: group.groupType,
      displayName: friend,
      ledgerId: group.ledger.id,
      currency: group.ledger.currency,
      currencyCode: group.ledger.currencyCode,
      participantCount: group.ledger._count.participants,
    }
  })
}

function selectGroups(
  contexts: GroupContext[],
  groupIds: string[] | undefined,
  currencies: string[] | undefined,
) {
  let selected = groupIds?.length
    ? contexts.filter((group) => groupIds.includes(group.id))
    : contexts.filter((group) => !group.archived && !group.hidden)
  if (currencies?.length) {
    selected = selected.filter((group) =>
      currencies.includes(currencyKey(group.currency, group.currencyCode)),
    )
  }
  return selected
}

async function listGlobalExpenses(
  accountId: string,
  input: GlobalExpensesInput,
) {
  if (
    (input.minAmount !== undefined ||
      input.maxAmount !== undefined ||
      input.sortBy === 'amount') &&
    input.currencies?.length !== 1
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Choose exactly one base currency before filtering by amount',
    })
  }
  const contexts = await getGroupContexts(accountId)
  const groups = selectGroups(contexts, input.groupIds, input.currencies)
  if (groups.length === 0)
    return { expenses: [], hasMore: false, nextCursor: null }

  const personFilters = composeGlobalPersonFilters(
    input.paidBy,
    input.paidByMatch,
    input.paidFor,
    input.paidForMatch,
  )

  let where: Prisma.ExpenseWhereInput = {
    ledgerId: { in: groups.map((group) => group.ledgerId) },
    categoryId: (() => {
      if (input.categories && input.categories.length > 0) {
        return { in: expandCategorySelection(input.categories) }
      }
      if (input.hideSettlements) {
        return { not: SETTLEMENT_CATEGORY_ID }
      }
      return undefined
    })(),
    expenseDate:
      input.dateFrom || input.dateTo
        ? {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {}),
          }
        : undefined,
    amount:
      input.minAmount !== undefined || input.maxAmount !== undefined
        ? {
            ...(input.minAmount !== undefined ? { gte: input.minAmount } : {}),
            ...(input.maxAmount !== undefined ? { lte: input.maxAmount } : {}),
          }
        : undefined,
  }
  if (personFilters) where.AND = personFilters.AND

  const query = input.query?.trim()
  if (query) {
    await loadLocaleDictionary(input.locale)
    const similarTitleIds = await findSimilarExpenseTitleIds({
      ledgerIds: groups.map((group) => group.ledgerId),
      query,
    })
    where = mergeWhereAnd(
      where,
      expenseTextSearchOr({
        query,
        locale: input.locale,
        similarTitleIds,
        includeNotesAndItems: true,
      }),
    )
  }

  if (input.cursor) {
    const cursor = decodeCursor(input.cursor)
    if (
      !cursor ||
      cursor.sortBy !== input.sortBy ||
      cursor.sortDir !== input.sortDir
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid expense cursor',
      })
    }
    const existingAnd = where.AND
    where.AND = [
      ...(Array.isArray(existingAnd)
        ? existingAnd
        : existingAnd
          ? [existingAnd]
          : []),
      cursorWhere(cursor),
    ]
  }

  const orderBy: Prisma.ExpenseOrderByWithRelationInput[] =
    input.sortBy === 'expenseDate'
      ? [
          { expenseDate: input.sortDir },
          { createdAt: input.sortDir },
          { id: input.sortDir },
        ]
      : [{ [input.sortBy]: input.sortDir }, { id: input.sortDir }]

  const rows = await prisma.expense.findMany({
    where,
    select: globalExpenseSelect,
    orderBy,
    take: input.limit + 1,
  })
  const hasMore = rows.length > input.limit
  const page = rows.slice(0, input.limit)
  const groupsByLedgerId = new Map(
    groups.map((group) => [group.ledgerId, group]),
  )
  const expenses = page.map((row) => {
    const { ledgerId, ...expenseRow } = row
    const group = groupsByLedgerId.get(ledgerId)
    if (!group) throw new Error('Global expense group context missing')
    return {
      ...mapExpenseListRow(expenseRow as ExpenseListDbRow),
      group: {
        id: group.id,
        name: group.name,
        archived: group.archived,
        hidden: group.hidden,
        groupType: group.groupType,
        displayName: group.displayName,
        currency: group.currency,
        currencyCode: group.currencyCode,
        participantCount: group.participantCount,
      },
    }
  })
  const last = page.at(-1)
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          sortBy: input.sortBy,
          sortDir: input.sortDir,
          value:
            input.sortBy === 'amount'
              ? last.amount
              : input.sortBy === 'expenseDate'
                ? last.expenseDate.toISOString()
                : last[input.sortBy].toISOString(),
          id: last.id,
          ...(input.sortBy === 'expenseDate'
            ? { createdAt: last.createdAt.toISOString() }
            : {}),
        })
      : null
  return { expenses, hasMore, nextCursor }
}

async function getGlobalExpenseFilterOptions(accountId: string) {
  const groups = await getGroupContexts(accountId)
  const ledgerIds = groups.map((group) => group.ledgerId)
  const participants =
    ledgerIds.length === 0
      ? []
      : await prisma.ledgerParticipant.findMany({
          where: { ledgerId: { in: ledgerIds } },
          select: {
            id: true,
            kind: true,
            displayName: true,
            ledgerId: true,
            groupMember: {
              select: {
                account: { select: { id: true, name: true } },
              },
            },
            invitations: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { email: true, temporaryName: true },
            },
          },
        })
  const groupsByLedgerId = new Map(
    groups.map((group) => [group.ledgerId, group]),
  )
  const people = new Map<
    string,
    {
      kind: 'account' | 'participant'
      id: string
      groupId?: string
      name: string
      groupName?: string
    }
  >()
  for (const participant of participants) {
    const group = groupsByLedgerId.get(participant.ledgerId)
    if (!group) continue
    const account = participant.groupMember?.account
    if (account) {
      const key = `account:${account.id}`
      if (!people.has(key)) {
        people.set(key, {
          kind: 'account',
          id: account.id,
          name: account.name ?? '',
        })
      }
      continue
    }
    const name = resolveParticipantDisplayName(participant)
    people.set(`participant:${participant.id}`, {
      kind: 'participant',
      id: participant.id,
      groupId: group.id,
      name,
      groupName: group.displayName,
    })
  }
  return {
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      archived: group.archived,
      hidden: group.hidden,
      groupType: group.groupType,
      displayName: group.displayName,
      currency: group.currency,
      currencyCode: group.currencyCode,
      participantCount: group.participantCount,
    })),
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    currencies: [
      ...new Map(
        groups.map((group) => [
          currencyKey(group.currency, group.currencyCode),
          {
            key: currencyKey(group.currency, group.currencyCode),
            currency: group.currency,
            currencyCode: group.currencyCode,
          },
        ]),
      ).values(),
    ],
  }
}

export const globalExpensesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(globalExpensesInputSchema)
    .output(globalExpensesListOutputSchema)
    .query(({ ctx, input }) => listGlobalExpenses(ctx.auth.user.id, input)),
  filterOptions: protectedProcedure
    .output(globalExpensesFilterOptionsOutputSchema)
    .query(({ ctx }) => getGlobalExpenseFilterOptions(ctx.auth.user.id)),
})
