import { NoObjectGeneratedError } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../test/mocks'
import { prismaMock } from '../../../test/state'

const generateText = vi.fn()
const fetchMock = vi.fn()
const envState = vi.hoisted(() => ({
  PUBLIC_ENABLE_CATEGORY_EXTRACT: false,
  AI_CATEGORY_ENGINE: 'llm' as 'llm' | 'system-one',
  AI_CATEGORY_RECENT_EXPENSES_LIMIT: 50,
  AI_CATEGORY_MODEL: 'test-category-model',
  AI_CATEGORY_TIMEOUT_SECONDS: 30,
  CATEGORY_MEMORY_LIMIT: 200,
  CATEGORY_DICTIONARY_ENABLED: true,
  CATEGORY_HISTORY_ENABLED: true,
  CATEGORY_LOCAL_MIN_SCORE: 0.7,
  CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE: 0.95,
  AI_SYSTEM_ONE_API_KEY: undefined as string | undefined,
  AI_SYSTEM_ONE_MODEL: 'jev-latest',
  AI_SYSTEM_ONE_TIMEOUT_SECONDS: 10,
  AI_SYSTEM_ONE_BASE_URL: 'https://api.typesafe.ai/v1/systemone',
  AI_CATEGORY_MIN_CONFIDENCE: 0.5,
}))

function systemOneResponse(choice: string, confidence = 0.9) {
  return {
    ok: true,
    json: async () => ({
      model: 'jev-1.13.0',
      answers: {
        category: {
          type: 'choice',
          choice,
          confidence,
          probabilities: { [choice]: confidence },
        },
      },
      usage: { input_tokens: 100, output_tokens: 10 },
    }),
  }
}

vi.mock('ai', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  generateText: (...args: unknown[]) => generateText(...args),
}))

vi.mock('../../ai', () => ({
  getModel: vi.fn(async () => ({})),
}))

vi.mock('../../env', () => ({ env: envState }))

const { suggestExpenseCategory } = await import('./suggest-category')

beforeEach(() => {
  generateText.mockReset()
  generateText.mockResolvedValue({
    text: '{"categoryId":"groceries","confidence":0.9}',
    output: { categoryId: 'groceries', confidence: 0.9 },
  })
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(systemOneResponse('groceries'))
  vi.stubGlobal('fetch', fetchMock)
  envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = false
  envState.AI_CATEGORY_ENGINE = 'llm'
  envState.CATEGORY_DICTIONARY_ENABLED = true
  envState.CATEGORY_HISTORY_ENABLED = true
  envState.AI_SYSTEM_ONE_API_KEY = undefined
  envState.AI_CATEGORY_MIN_CONFIDENCE = 0.5
  vi.spyOn(console, 'info').mockImplementation(() => {})
  prismaMock.group.findUnique.mockResolvedValue({
    name: 'Test Group',
    ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
  } as never)
  prismaMock.expense.findMany.mockResolvedValue([])
})

afterEach(() => {
  expect(console.info).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('suggestExpenseCategory', () => {
  it('returns a dictionary hit without querying expenses or calling the model', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
    const beforeAi = vi.fn()
    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'uber',
        allowAi: true,
        beforeAi,
      }),
    ).resolves.toEqual({ categoryId: 'taxi', candidates: [] })
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
    expect(beforeAi).not.toHaveBeenCalled()
  })

  it('returns null for 1–2 letter titles without querying or calling the model', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'a',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('returns a history exact match without calling the model', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ] as never)

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria',
      }),
    ).resolves.toEqual({ categoryId: 'dining-out', candidates: [] })
    expect(prismaMock.expense.findMany).toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('uses the same joint Local policy as the form when history beats a weaker dictionary match', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'weekly shop', categoryId: 'dining-out' },
      { title: 'weekly shop', categoryId: 'dining-out' },
    ] as never)

    await expect(
      suggestExpenseCategory({ groupId: 'group-1', title: 'weekly shop' }),
    ).resolves.toEqual({ categoryId: 'dining-out', candidates: [] })
    expect(generateText).not.toHaveBeenCalled()
  })

  it('returns null when history misses and AI is off', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ] as never)

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
    expect(generateText).not.toHaveBeenCalled()
  })

  it('calls the model when history misses and AI is allowed', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
    const beforeAi = vi.fn()
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ] as never)

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: true,
        beforeAi,
      }),
    ).resolves.toEqual({ categoryId: 'groceries', candidates: [] })
    expect(beforeAi).toHaveBeenCalledOnce()
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(beforeAi.mock.invocationCallOrder[0]).toBeLessThan(
      generateText.mock.invocationCallOrder[0]!,
    )
  })

  it('returns null when the LLM confidence is below the minimum', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ] as never)
    generateText.mockResolvedValueOnce({
      text: '{"categoryId":"groceries","confidence":0.4}',
      output: { categoryId: 'groceries', confidence: 0.4 },
    })

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: true,
      }),
      // Below-floor winner is not applied but still becomes a chip (a lone
      // verdict normalizes to probability 1).
    ).resolves.toEqual({
      categoryId: null,
      candidates: [{ id: 'groceries', score: 1, source: 'ai' }],
    })
  })

  it('returns null when the LLM verdict is unparsable and the floor is above zero', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ] as never)
    // A model without JSON-mode throws NoObjectGeneratedError; the legacy
    // plain-text fallback carries confidence 0.
    generateText.mockRejectedValueOnce(
      new NoObjectGeneratedError({
        message: 'No object generated',
        text: 'groceries',
      }),
    )

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
  })

  it('does not call the model when allowAi is false even if the flag is on', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: false,
      }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
    expect(generateText).not.toHaveBeenCalled()
  })

  it('returns null instead of failing when the model times out', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ] as never)
    generateText.mockRejectedValueOnce(
      new DOMException('timeout of 30000ms exceeded', 'TimeoutError'),
    )

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
  })

  it('rethrows non-timeout model errors', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ] as never)
    generateText.mockRejectedValueOnce(new Error('provider exploded'))

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: true,
      }),
    ).rejects.toThrow('provider exploded')
  })

  it('skips the dictionary stage when disabled', async () => {
    envState.CATEGORY_DICTIONARY_ENABLED = false

    await expect(
      suggestExpenseCategory({ groupId: 'group-1', title: 'uber' }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
    // History still ran (and missed), so expenses were queried.
    expect(prismaMock.expense.findMany).toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('skips fetching group history when the history stage is disabled', async () => {
    envState.CATEGORY_HISTORY_ENABLED = false

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
      }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })
})

describe('suggestExpenseCategory with AI_CATEGORY_ENGINE=system-one', () => {
  beforeEach(() => {
    envState.AI_CATEGORY_ENGINE = 'system-one'
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
    envState.AI_SYSTEM_ONE_API_KEY = 'test-system-one-key'
    prismaMock.group.findUnique.mockResolvedValue({
      name: 'Test Group',
      ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
    } as never)
    prismaMock.expense.findMany.mockResolvedValue([])
  })

  it('routes to System One instead of the LLM when local stages miss', async () => {
    const beforeAi = vi.fn()

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: true,
        beforeAi,
      }),
    ).resolves.toEqual({ categoryId: 'groceries', candidates: [] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-system-one-key',
    })
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('jev-latest')
    expect(body.state.expenseTitle).toBe('xyzzy-unknown')
    expect(body.state.recentExpenses).toEqual([])
    expect(generateText).not.toHaveBeenCalled()
    expect(beforeAi).toHaveBeenCalledOnce()
  })

  it('still prefers dictionary hits over System One', async () => {
    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'uber',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: 'taxi', candidates: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires allowAi and the extract flag like the LLM engine', async () => {
    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: false,
      }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('ignores AI_SYSTEM_ONE_API_KEY when the engine is llm', async () => {
    envState.AI_CATEGORY_ENGINE = 'llm'
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ] as never)

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: 'groceries', candidates: [] })
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends recent group expenses as System One state', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { title: 'Mercadona', categoryId: 'groceries' },
    ] as never)

    await suggestExpenseCategory({
      groupId: 'group-1',
      title: 'xyzzy-unknown',
      allowAi: true,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.state.recentExpenses).toEqual([
      { title: 'Mercadona', categoryId: 'groceries' },
    ])
    expect(generateText).not.toHaveBeenCalled()
  })

  it('returns null when System One picks the general no-match category', async () => {
    fetchMock.mockResolvedValueOnce(systemOneResponse('general', 0.4))

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
  })

  it('returns null when System One confidence is below the minimum', async () => {
    envState.AI_CATEGORY_MIN_CONFIDENCE = 0.95
    fetchMock.mockResolvedValueOnce(systemOneResponse('groceries', 0.9))

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: true,
      }),
      // Below-floor winner is not applied but still becomes a chip.
    ).resolves.toEqual({
      categoryId: null,
      candidates: [{ id: 'groceries', score: 0.9, source: 'ai' }],
    })
  })

  it.each([
    ['unknown probability key', { groceries: 0.9, unknown: 0.7 }],
    ['empty distribution', {}],
    ['missing winner key', { 'dining-out': 0.9 }],
  ])(
    'returns null when System One distribution is malformed (%s)',
    async (_label, probabilities) => {
      fetchMock.mockResolvedValueOnce(
        systemOneSplitResponse(probabilities, 'groceries', 0.9),
      )

      await expect(
        suggestExpenseCategory({
          groupId: 'group-1',
          title: 'xyzzy-unknown',
          allowAi: true,
        }),
      ).resolves.toEqual({ categoryId: null, candidates: [] })
    },
  )

  it('returns null instead of failing when System One times out', async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException('timeout of 10000ms exceeded', 'TimeoutError'),
    )

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: null, candidates: [] })
  })

  it('rethrows non-timeout System One errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('system-one exploded'))

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: true,
      }),
    ).rejects.toThrow('system-one exploded')
  })
})

function systemOneSplitResponse(
  probabilities: Record<string, number>,
  choice: string,
  confidence: number,
) {
  return {
    ok: true,
    json: async () => ({
      model: 'jev-1.13.0',
      answers: {
        category: { type: 'choice', choice, confidence, probabilities },
      },
      usage: { input_tokens: 100, output_tokens: 10 },
    }),
  }
}

describe('suggestExpenseCategory AI candidates', () => {
  beforeEach(() => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
  })

  it('returns the in-between runner as a chip on a System One hit', async () => {
    envState.AI_CATEGORY_ENGINE = 'system-one'
    envState.AI_SYSTEM_ONE_API_KEY = 'test-system-one-key'
    // коктели case: liquor applied at 0.6, dining-out 0.29 clears the 0.15
    // floor, food-and-drink 0.11 does not.
    fetchMock.mockResolvedValueOnce(
      systemOneSplitResponse(
        { liquor: 0.6, 'dining-out': 0.29, 'food-and-drink': 0.11 },
        'liquor',
        0.6,
      ),
    )

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: true,
      }),
    ).resolves.toEqual({
      categoryId: 'liquor',
      candidates: [{ id: 'dining-out', score: 0.29, source: 'ai' }],
    })
  })

  it('returns the top pick itself as a chip when System One is below the floor', async () => {
    envState.AI_CATEGORY_ENGINE = 'system-one'
    envState.AI_SYSTEM_ONE_API_KEY = 'test-system-one-key'
    // Below-floor winner: nothing applied, all runners above the floor
    // become chips, strongest first.
    fetchMock.mockResolvedValueOnce(
      systemOneSplitResponse(
        { 'food-and-drink': 0.43, liquor: 0.36, 'dining-out': 0.2 },
        'food-and-drink',
        0.4,
      ),
    )

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: true,
      }),
    ).resolves.toEqual({
      categoryId: null,
      candidates: [
        { id: 'food-and-drink', score: 0.43, source: 'ai' },
        { id: 'liquor', score: 0.36, source: 'ai' },
        { id: 'dining-out', score: 0.2, source: 'ai' },
      ],
    })
  })

  it('returns no candidates for a decisive System One verdict', async () => {
    envState.AI_CATEGORY_ENGINE = 'system-one'
    envState.AI_SYSTEM_ONE_API_KEY = 'test-system-one-key'
    fetchMock.mockResolvedValueOnce(
      systemOneSplitResponse(
        { taxi: 0.97, transportation: 0.03 },
        'taxi',
        0.95,
      ),
    )

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: 'taxi', candidates: [] })
  })

  it('returns normalized LLM runners as chips on a hit', async () => {
    envState.AI_CATEGORY_ENGINE = 'llm'
    generateText.mockResolvedValueOnce({
      text: '{"categoryId":"liquor","confidence":0.6}',
      output: {
        categoryId: 'liquor',
        confidence: 0.6,
        runnersUp: [
          { categoryId: 'dining-out', confidence: 0.3 },
          { categoryId: 'general', confidence: 0.9 },
        ],
      },
    })

    // Normalized over 0.6 + (0.6 + 0.3): liquor applied, dining-out chip.
    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'xyzzy-unknown',
        allowAi: true,
      }),
    ).resolves.toEqual({
      categoryId: 'liquor',
      candidates: [
        { id: 'dining-out', score: 0.3 / (0.6 + 0.3), source: 'ai' },
      ],
    })
  })
})
