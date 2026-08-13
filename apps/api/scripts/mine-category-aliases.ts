/**
 * Offline alias miner. Reads expense titles and prints candidate tokens that
 * are not already in the category-search dictionaries.
 *
 * Does not write files. Review the JSON and commit dictionary updates by hand.
 *
 * Package script: mine-category-aliases Flags: --locale --min-count
 * --min-token-length
 */

import { prisma } from '@spliit/db'
import {
  DEFAULT_MINE_EXCLUDE,
  aliasCandidatesToPatch,
  defaultLocale,
  loadLocaleDictionary,
  mineAliasCandidates,
} from '@spliit/domain'

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find((argument) => argument.startsWith(prefix))
  return hit?.slice(prefix.length)
}

function requiredPositiveInt(name: string, fallback: number): number {
  const raw = flag(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`)
  }
  return value
}

const BATCH_SIZE = 500

const locale = flag('locale') ?? defaultLocale
const minCount = requiredPositiveInt('min-count', 5)
const minTokenLength = requiredPositiveInt('min-token-length', 3)

const rows: { categoryId: string; title: string }[] = []

try {
  await loadLocaleDictionary(locale)

  let cursor: string | undefined
  for (;;) {
    const batch = await prisma.expense.findMany({
      where: {
        categoryId: { notIn: [...DEFAULT_MINE_EXCLUDE] },
        title: { not: '' },
      },
      select: { id: true, categoryId: true, title: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (batch.length === 0) break
    for (const row of batch) {
      rows.push({ categoryId: row.categoryId, title: row.title })
    }
    cursor = batch.at(-1)?.id
    if (batch.length < BATCH_SIZE) break
  }

  const groups = mineAliasCandidates(rows, {
    locale,
    minCount,
    minTokenLength,
  })

  console.log(
    JSON.stringify(
      {
        locale,
        minCount,
        minTokenLength,
        scanned: rows.length,
        candidates: groups,
        patch: aliasCandidatesToPatch(groups),
      },
      null,
      2,
    ),
  )
} finally {
  await prisma.$disconnect()
}
