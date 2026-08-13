import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../test/mocks'
import { prisma$QueryRaw, prismaMock } from '../../../test/state'

const generateText = vi.fn()
const envState = vi.hoisted(() => ({
  PUBLIC_ENABLE_CATEGORY_EXTRACT: false,
  AI_CATEGORY_RECENT_EXPENSES_LIMIT: 50,
  AI_CATEGORY_MODEL: 'test-category-model',
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
  prismaMock.group.findUnique.mockResolvedValue({
    name: 'Test Group',
    ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
  } as never)
  prismaMock.expense.findMany.mockResolvedValue([])
  prisma$QueryRaw.mockResolvedValue([])
})

describe('suggestExpenseCategory', () => {
  it('returns a dictionary hit without querying titles or calling the model', async () => {
    await expect(
      suggestExpenseCategory({ groupId: 'group-1', title: 'Whole Foods' }),
    ).resolves.toEqual({ categoryId: 'groceries' })
    expect(prismaMock.group.findUnique).not.toHaveBeenCalled()
    expect(prisma$QueryRaw).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('returns a similar-title history hit without calling the model', async () => {
    prisma$QueryRaw.mockResolvedValue([
      {
        id: 'exp-1',
        title: 'Luigi mysterious trattoria',
        categoryId: 'dining-out',
        similarity: 1,
      },
      {
        id: 'exp-2',
        title: 'Luigi mysterious trattoria',
        categoryId: 'dining-out',
        similarity: 0.9,
      },
    ])

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria',
      }),
    ).resolves.toEqual({ categoryId: 'dining-out' })
    expect(prisma$QueryRaw).toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('returns null when local matching is weak and AI is off', async () => {
    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: null })
    expect(generateText).not.toHaveBeenCalled()
  })

  it('calls the model when local matching is weak and AI is allowed', async () => {
    envState.PUBLIC_ENABLE_CATEGORY_EXTRACT = true

    await expect(
      suggestExpenseCategory({
        groupId: 'group-1',
        title: 'Luigi mysterious trattoria xyzzy',
        allowAi: true,
      }),
    ).resolves.toEqual({ categoryId: 'groceries' })
    expect(generateText).toHaveBeenCalledTimes(1)
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
