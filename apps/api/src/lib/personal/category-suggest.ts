import { prisma } from '@spliit/db'
import { DEFAULT_CATEGORY_ID, SETTLEMENT_CATEGORY_ID } from '@spliit/domain'

import type { RecentExpenseContext } from '../ai/context'
import { ensurePersonalProfile } from './profile'

/**
 * Personal categorization memory. Only categorized entries (never `general` or
 * settlements) carry signal; linked rows contribute their effective personal
 * category. The shared suggestion engine consumes this exactly like a group
 * ledger history.
 */
export async function getPersonalExpenseContext(
  accountId: string,
  limit: number,
): Promise<RecentExpenseContext> {
  const profile = await ensurePersonalProfile(accountId)
  const rows = await prisma.personalTransaction.findMany({
    where: {
      accountId,
      ...(profile.sharedEnabled ? {} : { source: 'PERSONAL' }),
      categoryId: { notIn: [DEFAULT_CATEGORY_ID, SETTLEMENT_CATEGORY_ID] },
      title: { not: null },
    },
    select: { title: true, categoryId: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  })

  return {
    // Personal has no group hint; the shared prompt builders treat an empty
    // name as "no group context".
    group: { name: '', currency: '$', currencyCode: null },
    expenses: rows
      .filter((row): row is { title: string; categoryId: string } =>
        Boolean(row.title),
      )
      .map((row) => ({ title: row.title, categoryId: row.categoryId })),
  }
}
