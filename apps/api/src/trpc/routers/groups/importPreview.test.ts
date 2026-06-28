import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSourceCache,
  getCachedSource,
} from '../../../lib/import-source-cache'
import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
import { groupsRouter } from './index'

const validExport = {
  id: 'grp-1',
  name: 'Trip',
  currency: '€',
  currencyCode: 'EUR',
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

async function makeCaller() {
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

describe('groups.importPreview', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearSourceCache()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    } as never)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a URL that is not on spliit.app', async () => {
    // ctx resolved per-call via makeCaller()
    const caller = await makeCaller()
    await expect(
      caller.importPreview({ sourceUrl: 'https://example.com/groups/abc' }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns OK on a successful fetch and caches the parsed source', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify(validExport),
      json: async () => validExport,
    })
    // ctx resolved per-call via makeCaller()
    const caller = await makeCaller()
    const result = await caller.importPreview({
      sourceUrl: 'https://spliit.app/groups/grp-1',
    })
    expect(result.kind).toBe('OK')
    if (result.kind !== 'OK') return
    expect(result.source.sourceGroupId).toBe('grp-1')
    expect(result.source.name).toBe('Trip')
    // Cached so a second call avoids the network.
    expect(getCachedSource('grp-1')).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const second = await caller.importPreview({
      sourceUrl: 'https://spliit.app/groups/grp-1',
    })
    expect(second.kind).toBe('OK')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns NOT_FOUND on HTTP 404', async () => {
    fetchMock.mockResolvedValue({
      status: 404,
      ok: false,
      text: async () => '',
      json: async () => ({}),
    })
    // ctx resolved per-call via makeCaller()
    const caller = await makeCaller()
    const result = await caller.importPreview({
      sourceUrl: 'https://spliit.app/groups/missing',
    })
    expect(result.kind).toBe('NOT_FOUND')
  })

  it('returns ERROR on non-2xx responses', async () => {
    fetchMock.mockResolvedValue({
      status: 503,
      ok: false,
      text: async () => 'Service Unavailable',
      json: async () => ({}),
    })
    // ctx resolved per-call via makeCaller()
    const caller = await makeCaller()
    const result = await caller.importPreview({
      sourceUrl: 'https://spliit.app/groups/grp-1',
    })
    expect(result.kind).toBe('ERROR')
  })

  it('returns ERROR when the response is not a valid Spliit export', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ unrelated: true }),
      json: async () => ({ unrelated: true }),
    })
    // ctx resolved per-call via makeCaller()
    const caller = await makeCaller()
    const result = await caller.importPreview({
      sourceUrl: 'https://spliit.app/groups/grp-1',
    })
    expect(result.kind).toBe('ERROR')
    if (result.kind !== 'ERROR') return
    // Friendly message, not a raw Zod dump.
    expect(result.message).toMatch(/not a supported spliit\.app JSON export/i)
  })

  it('returns ERROR when the rate limit is exceeded', async () => {
    // The rate-limit window is 10s and the threshold is 5 calls.
    // Exhaust the window against a fresh source id (so prior tests
    // don't pollute the rate-limit map) and confirm a 6th call is
    // rejected.
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify(validExport),
      json: async () => validExport,
    })
    // ctx resolved per-call via makeCaller()
    const caller = await makeCaller()
    const rateUrl = 'https://spliit.app/groups/grp-rate-limit'
    // Burn through the limit. The first call fetches and caches;
    // subsequent calls hit the cache (no fetch), but each still
    // consumes a rate-limit slot.
    for (let i = 0; i < 5; i++) {
      const r = await caller.importPreview({ sourceUrl: rateUrl })
      expect(r.kind).toBe('OK')
    }
    const blocked = await caller.importPreview({ sourceUrl: rateUrl })
    expect(blocked.kind).toBe('ERROR')
    if (blocked.kind === 'ERROR') {
      expect(blocked.message).toMatch(/too many requests/i)
    }
  })
})
