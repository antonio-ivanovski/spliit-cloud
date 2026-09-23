import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../env', () => ({
  env: {
    AI_SYSTEM_ONE_API_KEY: 'test-key',
    AI_SYSTEM_ONE_BASE_URL: 'https://example.test/systemone',
    AI_SYSTEM_ONE_MODEL: 'jev-latest',
    AI_SYSTEM_ONE_TIMEOUT_SECONDS: 10,
    AI_CATEGORY_MIN_CONFIDENCE: 0.6,
  },
}))

import {
  categorizeExpensesWithJev,
  relevantJevExamples,
} from './batch-categorize'
import { suggestCategoryWithSystemOne } from './system-one-categorize'

afterEach(() => vi.unstubAllGlobals())

describe('categorizeExpensesWithJev', () => {
  it('validates single and batch Jev answers through the same request parser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        return {
          ok: true,
          json: async () => ({
            answers: Object.fromEntries(
              Object.keys(body.questions).map((key) => [
                key,
                {
                  type: 'choice',
                  choice: 'groceries',
                  confidence: 0.82,
                  probabilities: {
                    groceries: 0.82,
                    'dining-out': 0.18,
                    unknown: 0.7,
                  },
                },
              ]),
            ),
          }),
        }
      }),
    )
    const single = await suggestCategoryWithSystemOne('Store', {
      apiKey: 'test-key',
    })
    const batch = await categorizeExpensesWithJev([
      { id: 'expense-1', title: 'Store', expenseDate: '2026-09-20' },
    ])
    expect(batch.get('expense-1')).toMatchObject({
      categoryId: single.categoryId,
      confidence: single.confidence,
      probabilities: [
        { categoryId: 'groceries', probability: 0.82 },
        { categoryId: 'dining-out', probability: 0.18 },
      ],
    })
    expect(single.probabilities).not.toHaveProperty('unknown')
  })

  it('batches independent choices and retains General, weak matches, and alternatives for review', async () => {
    const requests: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        requests.push(body)
        return {
          ok: true,
          json: async () => ({
            answers: Object.fromEntries(
              Object.keys(body.questions).map((key, index) => [
                key,
                {
                  type: 'choice',
                  choice: index === 1 ? 'general' : 'groceries',
                  confidence: index === 2 ? 0.4 : 0.9,
                  probabilities: {
                    groceries: index === 2 ? 0.4 : 0.9,
                    'dining-out': 0.25,
                  },
                },
              ]),
            ),
          }),
        }
      }),
    )
    const titles = Array.from({ length: 27 }, (_, index) => ({
      id: `e-${index}`,
      title: `Store ${index % 26}`,
      expenseDate: '2026-09-20T00:00:00.000Z',
    }))
    const result = await categorizeExpensesWithJev(titles, {
      examples: [{ title: 'Corner shop', categoryId: 'groceries' }],
    })
    expect(requests).toHaveLength(6)
    expect(
      Object.keys((requests[0] as { questions: object }).questions),
    ).toHaveLength(5)
    expect(result.get('e-0')?.categoryId).toBe('groceries')
    expect(result.get('e-1')?.categoryId).toBe('general')
    expect(result.get('e-2')?.confidence).toBe(0.4)
    expect(result.get('e-2')?.probabilities[1]?.categoryId).toBe('dining-out')
    expect(result.get('e-25')?.categoryId).toBe('groceries')
    expect(result.has('e-26')).toBe(true)
  })

  it('splits a batch when Jev exceeds its token limit', async () => {
    const sizes: number[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        const size = Object.keys(body.questions).length
        sizes.push(size)
        if (size > 2)
          return {
            ok: false,
            status: 400,
            json: async () => ({
              detail: { error_type: 'max_tokens_exceeded' },
            }),
          }
        return {
          ok: true,
          json: async () => ({
            answers: Object.fromEntries(
              Object.keys(body.questions).map((key) => [
                key,
                { type: 'choice', choice: 'groceries', confidence: 0.9 },
              ]),
            ),
          }),
        }
      }),
    )
    const result = await categorizeExpensesWithJev(
      Array.from({ length: 5 }, (_, index) => ({
        id: `e-${index}`,
        title: `Store ${index}`,
        expenseDate: '2026-09-20T00:00:00.000Z',
      })),
    )
    expect(sizes).toEqual([5, 3, 2, 1, 2])
    expect(result.size).toBe(5)
  })
})

describe('Jev example selection', () => {
  it('ranks matching titles and omits unrelated examples', () => {
    expect(
      relevantJevExamples('Corner Cafe', [
        { title: 'Taxi ride', categoryId: 'taxi' },
        { title: 'Corner Cafe', categoryId: 'dining-out' },
        { title: 'Cafe lunch', categoryId: 'food-and-drink' },
      ]).map((row) => row.categoryId),
    ).toEqual(['dining-out', 'food-and-drink'])
  })

  it('gives equal titles separate per-expense dates, neighbors and scoped rejections', async () => {
    const requests: Array<{
      questions: Record<
        string,
        {
          instructions: {
            expense: { expenseDate: string }
            nearbyExpenses: unknown[]
            rejectedCategories: string[]
          }
        }
      >
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        requests.push(body)
        return {
          ok: true,
          json: async () => ({
            answers: {
              expense_0: { type: 'choice', choice: 'taxi', confidence: 0.9 },
              expense_1: {
                type: 'choice',
                choice: 'groceries',
                confidence: 0.9,
              },
            },
          }),
        }
      }),
    )
    const result = await categorizeExpensesWithJev(
      [
        { id: 'old', title: 'Market', expenseDate: '2026-09-01T00:00:00.000Z' },
        { id: 'new', title: 'Market', expenseDate: '2026-09-21T00:00:00.000Z' },
      ],
      {
        rejectedExamples: [
          { title: 'Market', rejectedCategoryId: 'dining-out' },
          { title: 'Other', rejectedCategoryId: 'taxi' },
        ],
        neighborsById: new Map([
          [
            'new',
            [
              {
                title: 'Grocer',
                categoryId: 'groceries',
                expenseDate: '2026-09-20T00:00:00.000Z',
              },
            ],
          ],
        ]),
      },
    )
    expect(requests).toHaveLength(1)
    const oldQuestion = requests[0]!.questions.expense_0!.instructions
    const newQuestion = requests[0]!.questions.expense_1!.instructions
    expect(oldQuestion.expense.expenseDate).not.toBe(
      newQuestion.expense.expenseDate,
    )
    expect(oldQuestion.nearbyExpenses).toHaveLength(0)
    expect(newQuestion.nearbyExpenses).toHaveLength(1)
    expect(newQuestion.rejectedCategories).toEqual(['dining-out'])
    expect(result.get('old')?.categoryId).toBe('taxi')
    expect(result.get('new')?.categoryId).toBe('groceries')
  })
})
