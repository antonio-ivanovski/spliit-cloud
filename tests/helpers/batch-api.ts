import type { AppRouter } from '@/trpc/routers/_app'
import type { Page } from '@playwright/test'
import { RecurrenceRule, SplitMode } from '@prisma/client'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'

interface ExpenseFormValues {
  expenseDate: Date
  title: string
  category: number
  amount: number
  paidBy: string
  paidFor: Array<{ participant: string; shares: number }>
  splitMode: SplitMode
  isReimbursement: boolean
  recurrenceRule: RecurrenceRule
  saveDefaultSplittingOptions: boolean
  documents?: Array<{ id: string; url: string; width: number; height: number }>
  notes?: string
}

interface GroupFormValues {
  name: string
  information?: string
  currency: string
  currencyCode: string
  participants: Array<{ id?: string; name: string }>
}

function createTrpcClient(page: Page) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${new URL(page.url()).origin}/api/trpc`,
        async headers() {
          return {
            cookie: await page.evaluate(() => document.cookie),
          }
        },
        transformer: superjson,
      }),
    ],
  })
}

export async function createGroupViaAPI(
  page: Page,
  groupName: string,
  participants: string[],
  currency = 'USD',
): Promise<string> {
  const trpc = createTrpcClient(page)

  const groupFormValues: GroupFormValues = {
    name: groupName,
    currency,
    currencyCode: currency,
    participants: participants.map((name) => ({ name })),
  }

  const result = await trpc.groups.create.mutate({ groupFormValues })
  return result.groupId
}

export async function createExpensesViaAPI(
  page: Page,
  groupId: string,
  count: number,
  payerNames: string[] = ['Alice', 'Bob'],
): Promise<string[]> {
  const trpc = createTrpcClient(page)

  const expenseTitles: string[] = []

  const groupData = await trpc.groups.get.query({ groupId })
  const participants = groupData.group?.participants

  if (!participants) {
    throw new Error('Group participants not found')
  }

  for (let i = 1; i <= count; i++) {
    const title = `Expense ${String(i).padStart(2, '0')}`
    const amount = 1000 + i * 100
    const payerName = payerNames[i % payerNames.length]!
    const payer = participants.find((p) => p.name === payerName)
    if (!payer) {
      throw new Error(`Participant ${payerName} not found in group`)
    }

    const expenseFormValues: ExpenseFormValues = {
      expenseDate: new Date(),
      title,
      category: 0,
      amount,
      paidBy: payer.id,
      paidFor: participants.map((p) => ({
        participant: p.id,
        shares: 1,
      })),
      splitMode: SplitMode.EVENLY,
      isReimbursement: false,
      recurrenceRule: 'NONE',
      saveDefaultSplittingOptions: true,
    }

    await trpc.groups.expenses.create.mutate({
      groupId,
      expenseFormValues,
    })

    expenseTitles.push(title)
  }

  return expenseTitles
}
