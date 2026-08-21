import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../test/mocks'
import { prismaMock } from '../../../test/state'

const generateText = vi.fn()
const envState = vi.hoisted(() => ({
  PUBLIC_ENABLE_CATEGORY_EXTRACT: false,
  AI_CATEGORY_RECENT_EXPENSES_LIMIT: 50,
  AI_CATEGORY_MODEL: 'test-category-model',
  CATEGORY_MEMORY_LIMIT: 200,
}))

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateText(...args),
}))

vi.mock('../../ai', () => ({
  getModel: vi.fn(async () => ({})),
}))

vi.mock('../../env', () => ({ env: envState }))

const { suggestExpenseCategory } = await import('./suggest-category')

beforeEach(() => {
  generateText.mockReset()
  generateText.mockResolvedValue({ text: 'groceries' })
  envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = false
  vi.spyOn(console, 'info').mockImplementation(() => {})
  prismaMock.group.findUnique.mockResolvedValue({
    name: 'Test Group',
    ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
  } as never)
  prismaMock.expense.findMany.mockResolvedValue([])
})

afterEach(() => {
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
    ).resolves.toEqual({ categoryId: 'taxi' })
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
    expect(beforeAi).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"hit":"dictionary"'),
    )
  })

  it('returns null for 1–2 letter titles without querying or calling the model', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true
    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'a',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: null })
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
    ).resolves.toEqual({ categoryId: 'dining-out' })
    expect(prismaMock.expense.findMany).toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('"hit":"history"'),
    )
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
    ).resolves.toEqual({ categoryId: null })
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
    ).resolves.toEqual({ categoryId: 'groceries' })
    expect(beforeAi).toHaveBeenCalledOnce()
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(beforeAi.mock.invocationCallOrder[0]).toBeLessThan(
      generateText.mock.invocationCallOrder[0]!,
    )
  })

  it('does not call the model when allowAi is false even if the flag is on', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: false,
      }),
    ).resolves.toEqual({ categoryId: null })
    expect(generateText).not.toHaveBeenCalled()
  })
})
