import * as z from 'zod'

import { DEFAULT_CATEGORIES } from '../categories'
import { sharesAsFixedUnits } from '../shares'
import { legacyRuleToRecurrence } from './recurrence'
import {
  recoverSpliitOriginalAmount,
  shouldRecoverSpliitOriginal,
} from './spliit-original-amount'
import type {
  ImportParseResult,
  NormalizedSource,
  NormalizedSourceExpense,
} from './types'

/**
 * This parser intentionally targets the immutable legacy export produced by the
 * original spliit.app. Keep this wire schema stable; map its fields to the
 * current internal model in `normalizeSpliitExport` instead of adding current
 * Spliit Cloud recurrence state here.
 */
export const spliitExportSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().min(1).max(5),
  currencyCode: z.string().length(3).nullable().optional(),
  participants: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .min(1),
  expenses: z.array(
    z.object({
      title: z.string().min(1),
      amount: z.number().int().nonnegative(),
      paidById: z.string().min(1),
      paidFor: z
        .array(
          z.object({
            participantId: z.string().min(1),
            shares: z.number().int().nonnegative(),
          }),
        )
        .min(1),
      isReimbursement: z.boolean().default(false),
      splitMode: z
        .enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT'])
        .default('EVENLY'),
      recurrenceRule: z
        .enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'])
        .default('NONE'),
      expenseDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}/, 'expected an ISO date'),
      category: z
        .object({
          grouping: z.string(),
          name: z.string(),
        })
        .optional()
        .nullable(),
      originalAmount: z.coerce.number().int().nullable().optional(),
      originalCurrency: z.string().length(3).nullable().optional(),
      conversionRate: z.coerce.number().nullable().optional(),
      notes: z.string().optional(),
    }),
  ),
})

export type SpliitExport = z.infer<typeof spliitExportSchema>

class ImportError extends Error {}

function resolveCategoryId(
  category: SpliitExport['expenses'][number]['category'],
): string {
  if (!category) return 'general'
  const match = DEFAULT_CATEGORIES.find(
    (c) =>
      c.grouping.toLowerCase() === category.grouping.toLowerCase() &&
      c.name.toLowerCase() === category.name.toLowerCase(),
  )
  if (match) return match.id
  const partial = DEFAULT_CATEGORIES.find(
    (c) => c.name.toLowerCase() === category.name.toLowerCase(),
  )
  return partial?.id ?? 'general'
}

function normalizeSpliitExport(parsed: SpliitExport): NormalizedSource {
  const upstreamIdToSourceId = new Map<string, string>()
  const seenUpstreamIds = new Set<string>()
  const participants: NormalizedSource['participants'] =
    parsed.participants.map((p, index) => {
      if (seenUpstreamIds.has(p.id)) {
        throw new ImportError(
          `The export contains duplicate participant ids (id "${p.id}").`,
        )
      }
      seenUpstreamIds.add(p.id)
      const sourceId = `spliit-participant-${index}`
      upstreamIdToSourceId.set(p.id, sourceId)
      return { sourceId, sourceName: p.name }
    })

  const mustGetSourceId = (upstreamId: string, title: string): string => {
    const sourceId = upstreamIdToSourceId.get(upstreamId)
    if (!sourceId) {
      throw new ImportError(
        `Expense "${title}" references an unknown participant.`,
      )
    }
    return sourceId
  }

  const expenses: NormalizedSourceExpense[] = parsed.expenses.map((e) => {
    const paidBySourceId = mustGetSourceId(e.paidById, e.title)
    const paidFor: NormalizedSourceExpense['paidFor'] = []
    const seenInRow = new Set<string>()
    for (const row of e.paidFor) {
      const sourceId = mustGetSourceId(row.participantId, e.title)
      if (seenInRow.has(sourceId)) {
        throw new ImportError(
          `Expense "${e.title}" has duplicate paid-for participants.`,
        )
      }
      seenInRow.add(sourceId)
      if (!Number.isInteger(row.shares) || row.shares <= 0) {
        throw new ImportError(`Expense "${e.title}" has a non-positive share.`)
      }
      // Legacy whole-share weights from spliit.app's BY_SHARES export.
      // Spliit Cloud stores BY_SHARES as fixed units (`100 = 1 share`),
      // so multiply legacy whole numbers once to land in the new
      // internal representation. EVENLY/PERCENTAGE/AMOUNT modes pass
      // through unchanged because the same column carries the literal
      // mode-specific unit (basis points / minor units / even marker).
      const normalizedShares =
        e.splitMode === 'BY_SHARES'
          ? sharesAsFixedUnits(row.shares)
          : row.shares
      paidFor.push({ sourceId, shares: normalizedShares })
    }
    if (!Number.isInteger(e.amount) || e.amount < 0) {
      throw new ImportError(`Expense "${e.title}" has an invalid amount.`)
    }
    // Export `amount` is always the source-group ledger total (reliable).
    // Do not trust export `originalAmount` — recover from ledger ÷ rate
    // (upstream #513: originalAmount often drops cents). Once per parse only.
    const shouldRecover = shouldRecoverSpliitOriginal({
      originalCurrency: e.originalCurrency,
      conversionRate: e.conversionRate,
    })
    const expenseAmount = shouldRecover
      ? recoverSpliitOriginalAmount(e.amount, e.conversionRate!)
      : e.amount
    const expenseCurrency = shouldRecover
      ? e.originalCurrency!
      : (parsed.currencyCode ?? null)
    const recurrence = legacyRuleToRecurrence(e.recurrenceRule)

    return {
      title: e.title,
      expenseDate: e.expenseDate.slice(0, 10),
      category: resolveCategoryId(e.category ?? null),
      amountCurrency: expenseCurrency,
      amount: expenseAmount,
      originalAmount: shouldRecover ? expenseAmount : null,
      originalCurrency: shouldRecover ? e.originalCurrency! : null,
      conversionRate: shouldRecover ? e.conversionRate! : null,
      paidBySourceId,
      paidBy: [{ sourceId: paidBySourceId, shares: expenseAmount }],
      paidFor,
      splitMode: e.splitMode,
      recurrenceRule: e.recurrenceRule,
      recurrence,
      isReimbursement: e.isReimbursement,
      notes: e.notes ?? null,
    }
  })

  return {
    provider: 'SPLIIT',
    sourceGroupId: parsed.id,
    sourceUrl: `https://spliit.app/groups/${parsed.id}`,
    name: parsed.name,
    currency: parsed.currency,
    currencyCode: parsed.currencyCode ?? null,
    participants,
    expenses,
  }
}

export function parseSpliitExport(input: unknown): NormalizedSource {
  return normalizeSpliitExport(spliitExportSchema.parse(input))
}

export function tryParseSpliitExport(input: unknown): ImportParseResult {
  try {
    return { ok: true, source: parseSpliitExport(input) }
  } catch (err) {
    if (err instanceof ImportError) return { ok: false, error: err.message }
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        error: 'This file is not a supported spliit.app JSON export.',
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid Spliit export',
    }
  }
}

export function buildSpliitGroupFetchUrl(
  groupId: string,
  base: string = 'https://spliit.app',
): string {
  const trimmed = groupId.replace(/^\/+|\/+$/g, '')
  return `${base.replace(/\/+$/, '')}/groups/${trimmed}/expenses/export/json`
}

export function extractSpliitGroupIdFromUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (!/^(www\.)?spliit\.app$/i.test(url.hostname)) return null
  const match = url.pathname.match(/^\/groups\/([^/?#]+)/)
  if (!match) return null
  const id = match[1].replace(/^\/+|\/+$/g, '')
  return id.length > 0 ? id : null
}
