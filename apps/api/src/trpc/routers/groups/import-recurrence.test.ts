// organize-imports-ignore: ./mocks must be imported before modules that load @spliit/db.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../../test/mocks'
import { prismaMock } from '../../../test/state'

vi.mock(import('@spliit/jobs'), async (importOriginal) => {
  const jobs = await importOriginal()
  return {
    ...jobs,
    env: { ...jobs.env, JOBS_ENABLED: false },
  }
})

import { importGroup, type ImportInput } from '../../../lib/api'

const baseParticipants = [
  {
    mode: 'UNLINKED_PARTICIPANT' as const,
    sourceName: 'John',
    destLedgerParticipantId: 'dest-lp-1',
  },
  {
    mode: 'UNLINKED_PARTICIPANT' as const,
    sourceName: 'Jane',
    destLedgerParticipantId: 'dest-lp-2',
  },
]

function monthlyExpense(date: string) {
  return {
    expenseDate: new Date(`${date}T00:00:00.000Z`),
    title: 'Spotify Monthly',
    category: 'general',
    amount: 1000,
    paidBySplitMode: 'BY_AMOUNT',
    paidByList: [{ participant: 'dest-lp-1', shares: 1000 }],
    paidFor: [
      { participant: 'dest-lp-1', shares: 1 },
      { participant: 'dest-lp-2', shares: 1 },
    ],
    splitMode: 'EVENLY',
    isReimbursement: false,
    documents: [],
    recurrenceRule: 'MONTHLY' as const,
  }
}

describe('importGroup recurring collapse', () => {
  beforeEach(async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-importer',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue(null as never)
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      createdAt: new Date(),
      archived: false,
      ledgerId: 'dest-ledger',
      ledger: { id: 'dest-ledger', currency: '€', currencyCode: 'EUR' },
    } as never)
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'dest-gm',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    prismaMock.ledger.findUnique.mockResolvedValue({
      id: 'dest-ledger',
      currencyCode: 'EUR',
    } as never)
    prismaMock.recurringExpenseSeries.create.mockResolvedValue({
      id: 'series-1',
    } as never)
    prismaMock.expense.create.mockResolvedValue({} as never)
  })

  it('collapses matching monthly rows into one series with sequences', async () => {
    const seriesCreates: Array<{ data: Record<string, unknown> }> = []
    prismaMock.recurringExpenseSeries.create.mockImplementation(
      async (args: unknown) => {
        seriesCreates.push(args as { data: Record<string, unknown> })
        return { id: (args as { data: { id: string } }).data.id } as never
      },
    )
    const expenseCreates: Array<{ data: Record<string, unknown> }> = []
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      expenseCreates.push(args as { data: Record<string, unknown> })
      return {} as never
    })

    const input: ImportInput = {
      groupFormValues: {
        name: 'Imported',
        information: '',
        currency: '€',
        currencyCode: 'EUR',
        participants: [{ name: 'Owner' }],
      },
      participants: [...baseParticipants],
      expenses: [
        monthlyExpense('2025-05-19'),
        monthlyExpense('2025-06-19'),
        monthlyExpense('2025-07-19'),
      ] as never,
    }

    const result = await importGroup(input, { accountId: 'acct-importer' })
    expect(result.importedExpenses).toBe(3)
    expect(seriesCreates).toHaveLength(1)
    expect(seriesCreates[0]!.data.occurrencesCreated).toBe(3)
    expect(seriesCreates[0]!.data.nextOccurrenceOrdinal).toBe(2)
    expect(
      (seriesCreates[0]!.data.nextOccurrenceDate as Date)
        .toISOString()
        .slice(0, 10) > '2025-07-19',
    ).toBe(true)

    const sequences = expenseCreates.map(
      (row) => row.data.recurrenceSequence as number,
    )
    expect(sequences.sort((a, b) => a - b)).toEqual([1, 2, 3])
    const seriesIds = new Set(
      expenseCreates.map((row) => row.data.recurringSeriesId),
    )
    expect(seriesIds.size).toBe(1)
  })
})
