import { describe, expect, it } from 'vitest'

import {
  expenseTextSearchOr,
  findSimilarExpenseTitles,
  mergeWhereAnd,
} from './title-search'

describe('expenseTextSearchOr', () => {
  it('matches the title substring', () => {
    expect(expenseTextSearchOr({ query: 'pizza' }).OR).toEqual(
      expect.arrayContaining([
        { title: { contains: 'pizza', mode: 'insensitive' } },
      ]),
    )
  })

  it('expands a brand alias to the matching category', () => {
    expect(expenseTextSearchOr({ query: 'uber' }).OR).toEqual(
      expect.arrayContaining([{ categoryId: { in: ['taxi'] } }]),
    )
  })

  it('includes notes and item titles when requested', () => {
    expect(
      expenseTextSearchOr({ query: 'pizza', includeNotesAndItems: true }).OR,
    ).toEqual(
      expect.arrayContaining([
        { notes: { contains: 'pizza', mode: 'insensitive' } },
        {
          items: {
            some: { title: { contains: 'pizza', mode: 'insensitive' } },
          },
        },
      ]),
    )
  })

  it('ors similar title ids from trigram search', () => {
    expect(
      expenseTextSearchOr({
        query: 'starbukcs',
        similarTitleIds: ['exp-1'],
      }).OR,
    ).toEqual(expect.arrayContaining([{ id: { in: ['exp-1'] } }]))
  })
})

describe('findSimilarExpenseTitles', () => {
  it('returns an empty list for short queries without hitting the database', async () => {
    await expect(
      findSimilarExpenseTitles({ ledgerIds: ['ledger-1'], query: 'ub' }),
    ).resolves.toEqual([])
  })
})

describe('mergeWhereAnd', () => {
  it('appends a clause onto an existing AND list', () => {
    expect(
      mergeWhereAnd({ AND: [{ ledgerId: 'l1' }] }, { OR: [{ title: 'x' }] }),
    ).toEqual({
      AND: [{ ledgerId: 'l1' }, { OR: [{ title: 'x' }] }],
    })
  })
})
