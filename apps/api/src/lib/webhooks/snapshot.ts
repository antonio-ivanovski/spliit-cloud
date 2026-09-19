import type { Prisma, prisma } from '@spliit/db'
import type { WebhookExpenseSnapshot } from '@spliit/domain/webhooks'

type Client = Prisma.TransactionClient | typeof prisma

const expenseInclude = {
  ledger: { select: { currencyCode: true } },
  createdByAccount: { select: { id: true, name: true } },
  paidByList: {
    include: {
      ledgerParticipant: {
        include: {
          groupMember: {
            include: { account: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
  paidFor: {
    include: {
      ledgerParticipant: {
        include: {
          groupMember: {
            include: { account: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
  items: {
    include: {
      paidFor: {
        include: {
          ledgerParticipant: {
            include: {
              groupMember: {
                include: { account: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  },
  itemizedRemainder: {
    include: {
      paidFor: {
        include: {
          ledgerParticipant: {
            include: {
              groupMember: {
                include: { account: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  },
  documents: true,
  recurringSeries: true,
} as const satisfies Prisma.ExpenseInclude

type ExpenseWithRelations = Prisma.ExpenseGetPayload<{
  include: typeof expenseInclude
}>

function participant(row: {
  id: string
  displayName: string | null
  removedAt: Date | null
  groupMember: { account: { id: string; name: string } } | null
}) {
  return {
    id: row.id,
    name: row.groupMember?.account.name ?? row.displayName ?? 'Unknown',
    accountId: row.groupMember?.account.id ?? null,
    removed: row.removedAt !== null,
  }
}

export function serializeExpenseSnapshot(
  expense: ExpenseWithRelations,
): WebhookExpenseSnapshot {
  const share = (row: {
    shares: number
    ledgerParticipant: Parameters<typeof participant>[0]
  }) => ({
    participant: participant(row.ledgerParticipant),
    shares: row.shares,
  })
  return {
    id: expense.id,
    version: expense.version,
    title: expense.title,
    expenseDate: expense.expenseDate.toISOString(),
    expenseTimeZone: expense.expenseTimeZone,
    createdAt: expense.createdAt.toISOString(),
    categoryId: expense.categoryId,
    notes: expense.notes,
    amount: {
      ledger: {
        minor: expense.amount,
        currency: expense.ledger.currencyCode,
      },
      original:
        expense.originalAmount !== null && expense.originalCurrency !== null
          ? {
              minor: expense.originalAmount,
              currency: expense.originalCurrency,
            }
          : null,
      conversionRate: expense.conversionRate,
      conversionSource: expense.conversionSource,
    },
    splitMode: expense.splitMode,
    paidBySplitMode: expense.paidBySplitMode,
    paidBy: expense.paidByList.map(share),
    paidFor: expense.paidFor.map(share),
    items: expense.items.map((item) => ({
      id: item.id,
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode,
      notes: item.notes,
      paidFor: item.paidFor.map(share),
    })),
    itemizedRemainder: expense.itemizedRemainder
      ? {
          splitMode: expense.itemizedRemainder.splitMode,
          allocationMode: expense.itemizedRemainder.allocationMode,
          paidFor: expense.itemizedRemainder.paidFor.map(share),
        }
      : null,
    documents: expense.documents.map((document) => ({
      id: document.id,
      url: document.url,
      fileName: document.fileName,
      contentType: document.contentType,
      width: document.width,
      height: document.height,
    })),
    createdBy: expense.createdByAccount,
    recurrence: expense.recurringSeries
      ? {
          seriesId: expense.recurringSeries.id,
          sequence: expense.recurrenceSequence,
          frequency: expense.recurringSeries.frequency,
          interval: expense.recurringSeries.interval,
          endType: expense.recurringSeries.endType,
          occurrenceLimit: expense.recurringSeries.occurrenceLimit,
          endDate: expense.recurringSeries.endDate?.toISOString() ?? null,
          status: expense.recurringSeries.status,
        }
      : null,
    settlement: expense.categoryId === 'payment',
  }
}

export async function loadExpenseSnapshot(
  tx: Client,
  expenseId: string,
): Promise<WebhookExpenseSnapshot | null> {
  const expense = await tx.expense.findUnique({
    where: { id: expenseId },
    include: expenseInclude,
  })
  return expense ? serializeExpenseSnapshot(expense) : null
}

export const WEBHOOK_SNAPSHOT_BATCH_SIZE = 25

export async function loadExpenseSnapshotsChunked(
  tx: Client,
  expenseIds: string[],
  batchSize: number = WEBHOOK_SNAPSHOT_BATCH_SIZE,
): Promise<WebhookExpenseSnapshot[]> {
  const snapshots: WebhookExpenseSnapshot[] = []
  for (let index = 0; index < expenseIds.length; index += batchSize) {
    const chunk = expenseIds.slice(index, index + batchSize)
    const rows = await Promise.all(
      chunk.map((id) => loadExpenseSnapshot(tx, id)),
    )
    for (const row of rows) {
      if (row) snapshots.push(row)
    }
  }
  return snapshots
}
