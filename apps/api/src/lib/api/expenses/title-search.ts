import { Prisma, prisma } from '@spliit/db'
import {
  SETTLEMENT_CATEGORY_ID,
  expandExpenseQueryForLocale,
} from '@spliit/domain'

const TITLE_TRIGRAM_MIN_LENGTH = 3
const TITLE_TRIGRAM_MIN_SIMILARITY = 0.35
const TITLE_TRIGRAM_ID_LIMIT = 250
/** Similar titles fed into category voting — smaller than list-search. */
export const TITLE_TRIGRAM_CATEGORY_LIMIT = 50

export type SimilarExpenseTitle = {
  id: string
  title: string
  categoryId: string
  similarity: number
}

type SimilarTitleRow = {
  id: string
  title: string
  categoryId: string
  similarity: unknown
}

export async function findSimilarExpenseTitles(args: {
  ledgerIds: readonly string[]
  query: string
  limit?: number
  excludeReimbursements?: boolean
  excludeCategoryIds?: readonly string[]
}): Promise<SimilarExpenseTitle[]> {
  const query = args.query.trim()
  if (query.length < TITLE_TRIGRAM_MIN_LENGTH || args.ledgerIds.length === 0) {
    return []
  }
  const limit = args.limit ?? TITLE_TRIGRAM_ID_LIMIT
  const reimbursementFilter = args.excludeReimbursements
    ? Prisma.sql`AND "categoryId" <> ${SETTLEMENT_CATEGORY_ID}`
    : Prisma.sql``
  const categoryFilter =
    args.excludeCategoryIds && args.excludeCategoryIds.length > 0
      ? Prisma.sql`AND "categoryId" NOT IN (${Prisma.join([...args.excludeCategoryIds])})`
      : Prisma.sql``

  const rows = await prisma.$queryRaw<SimilarTitleRow[]>`
    SELECT id, title, "categoryId",
      GREATEST(similarity(title, ${query}), word_similarity(${query}, title)) AS similarity
    FROM "Expense"
    WHERE "ledgerId" IN (${Prisma.join([...args.ledgerIds])})
      ${reimbursementFilter}
      ${categoryFilter}
      AND (title % ${query} OR ${query} <% title)
      AND GREATEST(similarity(title, ${query}), word_similarity(${query}, title))
        >= ${TITLE_TRIGRAM_MIN_SIMILARITY}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    categoryId: row.categoryId,
    similarity: Number(row.similarity),
  }))
}

export async function findSimilarExpenseTitleIds(args: {
  ledgerIds: readonly string[]
  query: string
}): Promise<string[]> {
  const rows = await findSimilarExpenseTitles(args)
  return rows.map((row) => row.id)
}

export function expenseTextSearchOr(args: {
  query: string
  locale?: string
  similarTitleIds?: readonly string[]
  includeNotesAndItems?: boolean
}): Prisma.ExpenseWhereInput {
  const filter = args.query.trim()
  const { categoryIds } = expandExpenseQueryForLocale(filter, args.locale)
  const or: Prisma.ExpenseWhereInput[] = [
    { title: { contains: filter, mode: 'insensitive' } },
  ]
  if (args.includeNotesAndItems) {
    or.push({ notes: { contains: filter, mode: 'insensitive' } })
    or.push({
      items: {
        some: { title: { contains: filter, mode: 'insensitive' } },
      },
    })
  }
  if (args.similarTitleIds && args.similarTitleIds.length > 0) {
    or.push({ id: { in: [...args.similarTitleIds] } })
  }
  if (categoryIds.length > 0) {
    or.push({ categoryId: { in: categoryIds } })
  }
  return { OR: or }
}

export function mergeWhereAnd(
  where: Prisma.ExpenseWhereInput,
  clause: Prisma.ExpenseWhereInput,
): Prisma.ExpenseWhereInput {
  const existing = where.AND
  const extra = Array.isArray(existing) ? existing : existing ? [existing] : []
  return { ...where, AND: [...extra, clause] }
}
