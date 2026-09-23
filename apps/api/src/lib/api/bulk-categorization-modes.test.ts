import { beforeEach, describe, expect, it, vi } from 'vitest'

const systemOne = vi.hoisted(() => vi.fn())
vi.mock('../ai/batch-categorize', () => ({
  categorizeExpensesWithSystemOne: systemOne,
}))
vi.mock('../ai/context', () => ({
  getRecentExpenseContext: vi.fn(async () => ({ expenses: [] })),
}))

import {
  suggestRows,
  type Candidate,
  type RunData,
} from './bulk-categorization-run'

const candidate: Candidate = {
  id: 'expense-1',
  title: 'nike',
  version: 1,
  expenseDate: '2026-09-22T00:00:00.000Z',
  amount: 100,
  currency: 'USD',
}

function run(mode: 'local' | 'system-one'): RunData {
  return {
    id: 'run-1',
    groupId: 'group-1',
    accountId: 'account-1',
    mode,
    status: 'PROCESSING',
    locale: 'en-US',
    total: 1,
    processed: 0,
    round: 1,
    applied: 0,
    skipped: 0,
    candidates: [],
    calibration: {},
    examples: [],
    suggestions: [],
    error: null,
  }
}

beforeEach(() => systemOne.mockReset())

describe('bulk categorization modes', () => {
  it('uses only local ranking and stores scored primary and alternatives', async () => {
    const [suggestion] = await suggestRows(run('local'), [candidate], [])
    expect(systemOne).not.toHaveBeenCalled()
    expect(suggestion?.source).toBe('local')
    expect(suggestion?.choices[0]).toMatchObject({
      categoryId: suggestion?.categoryId,
      source: 'local',
      matchScore: expect.any(Number),
      floor: expect.any(Number),
    })
    expect(suggestion?.choices.length).toBeGreaterThan(1)
    expect(suggestion?.choices.length).toBeLessThanOrEqual(3)
    expect(
      suggestion?.choices.slice(1).every((choice) => choice.matchScore != null),
    ).toBe(true)
  })

  it('uses System One for every candidate without a local override', async () => {
    systemOne.mockResolvedValue(
      new Map([
        [
          'expense-1',
          {
            categoryId: 'groceries',
            confidence: 0.9,
            probabilities: [{ categoryId: 'groceries', probability: 0.9 }],
          },
        ],
      ]),
    )
    const [suggestion] = await suggestRows(run('system-one'), [candidate], [])
    expect(systemOne).toHaveBeenCalledWith(
      [{ id: 'expense-1', title: 'nike', expenseDate: candidate.expenseDate }],
      expect.any(Object),
    )
    expect(suggestion?.categoryId).toBe('groceries')
    expect(suggestion?.source).toBe('system-one')
    expect(suggestion?.choices[0]).toMatchObject({
      categoryId: 'groceries',
      confidence: 0.9,
      source: 'system-one',
      evidenceKind: 'model-confidence',
    })
  })

  it('leaves General selected when System One gives a strong runner-up', async () => {
    systemOne.mockResolvedValue(
      new Map([
        [
          'expense-1',
          {
            categoryId: 'general',
            confidence: 0.9,
            probabilities: [{ categoryId: 'groceries', probability: 0.9 }],
          },
        ],
      ]),
    )
    const [suggestion] = await suggestRows(run('system-one'), [candidate], [])
    expect(suggestion?.categoryId).toBe('general')
    expect(suggestion?.choices[0]?.categoryId).toBe('groceries')
    expect(suggestion?.choices[0]?.evidenceKind).toBe('option-probability')
  })
})
