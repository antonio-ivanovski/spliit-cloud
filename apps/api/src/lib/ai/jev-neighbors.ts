import { prisma } from '@spliit/db'
import {
  DEFAULT_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  type CategoryId,
} from '@spliit/domain'

import type { JevExpense, JevNeighbor } from './batch-categorize'

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

type DatedExample = JevNeighbor & { id: string }

export function selectDateNeighbors(
  target: JevExpense,
  examples: readonly DatedExample[],
): JevNeighbor[] {
  const date = Date.parse(target.expenseDate)
  if (!Number.isFinite(date)) return []
  const eligible = examples.filter(
    (row) =>
      row.id !== target.id &&
      row.categoryId !== DEFAULT_CATEGORY_ID &&
      row.categoryId !== SETTLEMENT_CATEGORY_ID &&
      Math.abs(Date.parse(row.expenseDate) - date) <= WINDOW_MS,
  )
  const before = eligible
    .filter((row) => Date.parse(row.expenseDate) <= date)
    .sort((a, b) => Date.parse(b.expenseDate) - Date.parse(a.expenseDate))
    .slice(0, 3)
  const beforeIds = new Set(before.map((row) => row.id))
  const after = eligible
    .filter(
      (row) => Date.parse(row.expenseDate) >= date && !beforeIds.has(row.id),
    )
    .sort((a, b) => Date.parse(a.expenseDate) - Date.parse(b.expenseDate))
    .slice(0, 3)
  return [...before, ...after].map(({ title, categoryId, expenseDate }) => ({
    title,
    categoryId,
    expenseDate,
  }))
}

export async function loadJevDateNeighbors(
  groupId: string,
  targets: readonly JevExpense[],
  confirmed: readonly DatedExample[],
): Promise<Map<string, JevNeighbor[]>> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group) throw new Error('Group not found')
  const result = new Map<string, JevNeighbor[]>()
  for (let offset = 0; offset < targets.length; offset += 5) {
    await Promise.all(
      targets.slice(offset, offset + 5).map(async (target) => {
        const date = new Date(target.expenseDate)
        if (!Number.isFinite(date.getTime())) return
        const start = new Date(date.getTime() - WINDOW_MS)
        const end = new Date(date.getTime() + WINDOW_MS)
        const where = {
          ledgerId: group.ledgerId,
          categoryId: { notIn: [DEFAULT_CATEGORY_ID, SETTLEMENT_CATEGORY_ID] },
        }
        const [before, after] = await Promise.all([
          prisma.expense.findMany({
            where: { ...where, expenseDate: { gte: start, lte: date } },
            select: {
              id: true,
              title: true,
              categoryId: true,
              expenseDate: true,
            },
            orderBy: [{ expenseDate: 'desc' }, { id: 'asc' }],
            take: 6,
          }),
          prisma.expense.findMany({
            where: { ...where, expenseDate: { gte: date, lte: end } },
            select: {
              id: true,
              title: true,
              categoryId: true,
              expenseDate: true,
            },
            orderBy: [{ expenseDate: 'asc' }, { id: 'asc' }],
            take: 6,
          }),
        ])
        const known = new Map<string, DatedExample>()
        for (const row of [...before, ...after])
          known.set(row.id, {
            id: row.id,
            title: row.title,
            categoryId: row.categoryId as CategoryId,
            expenseDate: row.expenseDate.toISOString(),
          })
        for (const row of confirmed) known.set(row.id, row)
        result.set(target.id, selectDateNeighbors(target, [...known.values()]))
      }),
    )
  }
  return result
}
