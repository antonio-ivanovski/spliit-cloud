import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSourceCache,
  setCachedSource,
} from '../../../lib/import-source-cache'
import '../../../test/mocks'
import { groupsRouter } from './index'

const validExport = {
  id: 'src-1',
  name: 'Source',
  currency: '$',
  currencyCode: 'USD',
  participants: [{ id: 'p1', name: 'A' }],
  expenses: [
    {
      title: 'X',
      amount: 1000,
      paidById: 'p1',
      paidFor: [{ participantId: 'p1', shares: 1000 }],
      isReimbursement: false,
      splitMode: 'EVENLY',
      recurrenceRule: 'NONE',
      expenseDate: '2025-11-15T00:00:00.000Z',
    },
  ],
}

function makeCaller() {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: 'acct-1',
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never)
}

describe('groups.lookup — not-found hand-off', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearSourceCache()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns IMPORTABLE on a cache hit without re-fetching', async () => {
    setCachedSource('src-1', {
      sourceGroupId: 'src-1',
      name: 'Source',
      currency: '$',
      currencyCode: 'USD',
      participants: [{ sourceId: 'p1', sourceName: 'A' }],
      expenses: [],
    })
    const caller = makeCaller()
    const result = await caller.lookup({ groupId: 'src-1' })
    expect(result.status).toBe('IMPORTABLE')
    expect(result.sourceProvider).toBe('SPLIIT')
    expect(result.sourceGroupId).toBe('src-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches and caches on a cache miss when the source is reachable', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify(validExport),
      json: async () => validExport,
    })
    const caller = makeCaller()
    const result = await caller.lookup({ groupId: 'src-1' })
    expect(result.status).toBe('IMPORTABLE')
    expect(result.source.name).toBe('Source')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws NOT_FOUND when the source is missing everywhere', async () => {
    fetchMock.mockResolvedValue({
      status: 404,
      ok: false,
      text: async () => '',
      json: async () => ({}),
    })
    const caller = makeCaller()
    await expect(caller.lookup({ groupId: 'src-missing' })).rejects.toThrow(
      /not found/i,
    )
  })

  it('throws NOT_FOUND on upstream error (5xx, malformed JSON, etc.)', async () => {
    fetchMock.mockResolvedValue({
      status: 503,
      ok: false,
      text: async () => 'unavailable',
      json: async () => ({}),
    })
    const caller = makeCaller()
    await expect(caller.lookup({ groupId: 'src-1' })).rejects.toThrow(
      /not found/i,
    )
  })
})
