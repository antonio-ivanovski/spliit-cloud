import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_SYSTEM_ONE_API_URL,
  suggestCategoryWithSystemOne,
  systemOneCategoryOptions,
} from './system-one-categorize'

const fetchMock = vi.fn()

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

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('systemOneCategoryOptions', () => {
  it('excludes the settlement category but keeps general as no-match', () => {
    const ids = systemOneCategoryOptions().map((option) => option.id)
    expect(ids).not.toContain('settlement')
    expect(ids).toContain('general')
    expect(ids).toContain('groceries')
    expect(ids.length).toBeLessThanOrEqual(255)
  })
})

describe('suggestCategoryWithSystemOne', () => {
  it('sends title, locale, group, and recent expenses as state', async () => {
    fetchMock.mockResolvedValueOnce(systemOneResponse('groceries'))

    const result = await suggestCategoryWithSystemOne('Mercadona weekly shop', {
      apiKey: 'test-key',
      model: 'jev-latest',
      timeoutSeconds: 10,
      locale: 'es',
      groupContext: { name: 'Trip', currency: '$', currencyCode: 'EUR' },
      recentExpenses: [{ title: 'Mercadona', categoryId: 'groceries' }],
    })

    expect(result).toEqual({
      categoryId: 'groceries',
      confidence: 0.9,
      probabilities: { groceries: 0.9 },
      marginTopTwo: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(DEFAULT_SYSTEM_ONE_API_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    })
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('jev-latest')
    expect(body.state.expenseTitle).toBe('Mercadona weekly shop')
    expect(body.state.appLanguage).toBe('Español')
    expect(body.state.group).toEqual({ name: 'Trip', currency: 'EUR' })
    expect(body.state.recentExpenses).toEqual([
      { title: 'Mercadona', categoryId: 'groceries' },
    ])
    expect(body.questions.category.type).toBe('choice')
    expect(body.questions.category.criteria['settlement']).toBeUndefined()
    expect(body.questions.category.criteria['groceries']).toBeDefined()
  })

  it('sends requests to a custom base URL when configured', async () => {
    fetchMock.mockResolvedValueOnce(systemOneResponse('groceries'))

    await suggestCategoryWithSystemOne('Mercadona weekly shop', {
      apiKey: 'local',
      model: 'kev-8b',
      baseUrl: 'http://127.0.0.1:8009/v1/systemone',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8009/v1/systemone')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('kev-8b')
  })

  it('truncates long titles to 40 characters like the LLM fallback', async () => {
    fetchMock.mockResolvedValueOnce(systemOneResponse('groceries'))

    await suggestCategoryWithSystemOne('a'.repeat(100), {
      apiKey: 'test-key',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.state.expenseTitle).toHaveLength(40)
  })

  it('maps general (no-match) to null', async () => {
    fetchMock.mockResolvedValueOnce(systemOneResponse('general', 0.4))

    await expect(
      suggestCategoryWithSystemOne('xyzzy', { apiKey: 'test-key' }),
    ).resolves.toEqual({
      categoryId: null,
      confidence: 0.4,
      probabilities: { general: 0.4 },
      marginTopTwo: 0,
    })
  })

  it('reports the gap between the top two probabilities', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          category: {
            type: 'choice',
            choice: 'groceries',
            confidence: 0.46,
            probabilities: { groceries: 0.45, 'dining-out': 0.44, taxi: 0.01 },
          },
        },
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    })

    const result = await suggestCategoryWithSystemOne('xyzzy', {
      apiKey: 'test-key',
    })

    expect(result.categoryId).toBe('groceries')
    expect(result.confidence).toBe(0.46)
    expect(result.marginTopTwo).toBeCloseTo(0.01, 10)
  })

  it('maps below-threshold verdicts to null but keeps the figures', async () => {
    fetchMock.mockResolvedValueOnce(systemOneResponse('groceries', 0.46))

    await expect(
      suggestCategoryWithSystemOne('xyzzy', {
        apiKey: 'test-key',
        minConfidence: 0.5,
      }),
    ).resolves.toEqual({
      categoryId: null,
      confidence: 0.46,
      probabilities: { groceries: 0.46 },
      marginTopTwo: 0,
    })
  })

  it('accepts at-threshold verdicts', async () => {
    fetchMock.mockResolvedValueOnce(systemOneResponse('groceries', 0.5))

    await expect(
      suggestCategoryWithSystemOne('xyzzy', {
        apiKey: 'test-key',
        minConfidence: 0.5,
      }),
    ).resolves.toMatchObject({ categoryId: 'groceries' })
  })

  it('maps unknown choices to null', async () => {
    fetchMock.mockResolvedValueOnce(systemOneResponse('not-a-category'))

    await expect(
      suggestCategoryWithSystemOne('xyzzy', { apiKey: 'test-key' }),
    ).resolves.toMatchObject({ categoryId: null })
  })

  it('throws on non-ok responses so callers can decide how to degrade', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 })

    await expect(
      suggestCategoryWithSystemOne('xyzzy', { apiKey: 'test-key' }),
    ).rejects.toThrow('status 429')
  })

  it('lets timeouts propagate to the caller', async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException('The operation timed out', 'TimeoutError'),
    )

    await expect(
      suggestCategoryWithSystemOne('xyzzy', { apiKey: 'test-key' }),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
