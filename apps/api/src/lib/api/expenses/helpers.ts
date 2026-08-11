import {
  categoryIdSchema,
  conversionFromStored,
  DEFAULT_CATEGORY_ID,
  getCategoryById,
  type Category,
  type CategoryId,
  type Expense,
} from '@spliit/domain'

import { promoteUploadedDocument } from '../../../routes/upload'
import { toRecurrenceConfig } from '../recurrence-series'
import type { getExpense } from './queries'

/**
 * Resolve a `categoryId` string from the database to the in-code
 * {@link Category} object. Returns the default "General" category when the
 * stored id is not in the in-code list (e.g. it was written by an older version
 * of the app or is otherwise invalid).
 */
export function resolveCategory(categoryId: string): Category {
  const parsedCategoryId = categoryIdSchema.safeParse(categoryId)
  return (
    (parsedCategoryId.success
      ? getCategoryById(parsedCategoryId.data)
      : undefined) ?? getCategoryById(DEFAULT_CATEGORY_ID)!
  )
}

/**
 * Narrow a `categoryId` string from the database to the {@link CategoryId}
 * literal union, falling back to the default category if the stored id is not
 * in the in-code list.
 */
export function narrowCategoryId(categoryId: string): CategoryId {
  const parsed = categoryIdSchema.safeParse(categoryId)
  return parsed.success ? parsed.data : DEFAULT_CATEGORY_ID
}

/**
 * Normalize the Prisma `getExpense` return value to the domain `Expense` shape
 * expected by diff and affected-participant utilities. The Prisma model stores
 * `ledgerParticipantId` while the domain uses `participant` for payer / split /
 * item references.
 */
/**
 * Map a stored expense into the shape used by activity diffs. `amount` is the
 * ledger total; flat conversion fields are attached for amount/conversion
 * differs (in addition to the `conversion` discriminant).
 */
export function toExpenseDomainShape(
  existing: NonNullable<Awaited<ReturnType<typeof getExpense>>>,
): Expense & {
  originalAmount?: number
  originalCurrency?: string
  conversionRate?: number
  conversionSource?: 'EXCHANGE' | 'CUSTOM' | null
} {
  return {
    title: existing.title,
    amount: existing.amount,
    expenseDate:
      (existing as { expenseAt?: Date }).expenseAt ?? existing.expenseDate,
    expenseAt:
      (existing as { expenseAt?: Date }).expenseAt ?? existing.expenseDate,
    expenseTimeZone:
      (existing as { expenseTimeZone?: string }).expenseTimeZone ?? 'UTC',
    category: existing.categoryId as Expense['category'],
    notes: existing.notes ?? undefined,
    recurrenceRule: existing.recurringSeries?.frequency ?? 'NONE',
    recurrence: existing.recurringSeries
      ? toRecurrenceConfig(existing.recurringSeries)
      : null,
    splitMode: existing.splitMode,
    paidBySplitMode: existing.paidBySplitMode,
    paidByList: existing.paidByList.map((pb) => ({
      participant: pb.ledgerParticipantId,
      shares: pb.shares,
    })),
    paidFor: existing.paidFor.map((pf) => ({
      participant: pf.ledgerParticipantId,
      shares: pf.shares,
    })),
    items: (existing.items ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((pf) => ({
        participant: pf.ledgerParticipantId,
        shares: pf.shares,
      })),
    })),
    itemizedRemainder: existing.itemizedRemainder
      ? {
          splitMode: existing.itemizedRemainder.splitMode,
          paidFor: existing.itemizedRemainder.paidFor.map((pf) => ({
            participant: pf.ledgerParticipantId,
            shares: pf.shares,
          })),
        }
      : undefined,
    documents: existing.documents.map((d) => ({
      id: d.id,
      url: d.url,
      fileName: d.fileName,
      contentType: d.contentType,
      width: d.width,
      height: d.height,
    })),
    conversion: conversionFromStored({
      conversionSource: existing.conversionSource,
      originalCurrency: existing.originalCurrency,
      conversionRate: existing.conversionRate,
    }),
    originalAmount: existing.originalAmount ?? undefined,
    originalCurrency: existing.originalCurrency ?? undefined,
    conversionRate: existing.conversionRate ?? undefined,
    conversionSource: existing.conversionSource,
    isReimbursement: existing.isReimbursement,
  } as Expense & {
    originalAmount?: number
    originalCurrency?: string
    conversionRate?: number
    conversionSource?: 'EXCHANGE' | 'CUSTOM' | null
  }
}
export async function promoteExpenseDocuments(
  documents: Array<{
    id: string
    url: string
    fileName?: string | null
    contentType?: string | null
    width?: number | null
    height?: number | null
  }>,
): Promise<typeof documents> {
  return Promise.all(
    documents.map(async (doc) => ({
      ...doc,
      url: await promoteUploadedDocument(doc.url),
    })),
  )
}
