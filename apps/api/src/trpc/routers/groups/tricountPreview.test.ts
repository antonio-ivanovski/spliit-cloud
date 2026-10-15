import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearSourceCache,
  getCachedSource,
} from '../../../lib/import-source-cache'
import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
import { groupsRouter } from './index'

function member(name: string) {
  return { RegistryMembershipNonUser: { alias: { display_name: name } } }
}

const registryPayload = {
  Response: [
    {
      Registry: {
        title: 'City trip',
        description: '',
        currency: 'USD',
        public_identifier_token: 'tMjbqgwJxaikhUbkNz',
        memberships: [member('Alex'), member('Julia')],
        all_registry_entry: [
          {
            RegistryEntry: {
              id: 1,
              status: 'ACTIVE',
              amount: { currency: 'USD', value: '-85.00' },
              description: 'Hotel',
              type_transaction: 'NORMAL',
              membership_owned: member('Alex'),
              allocations: [
                {
                  amount: { currency: 'USD', value: '-42.50' },
                  membership: member('Alex'),
                  type: 'RATIO',
                  share_ratio: 1,
                },
                {
                  amount: { currency: 'USD', value: '-42.50' },
                  membership: member('Julia'),
                  type: 'RATIO',
                  share_ratio: 1,
                },
              ],
              category: 'UNCATEGORIZED',
              category_custom: null,
              date: '2018-10-16 17:46:56.000000',
            },
          },
        ],
      },
    },
  ],
}

const authPayload = {
  Response: [{ Token: { token: 'tok' } }, { UserPerson: { id: 7 } }],
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

describe('groups.tricountPreview', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearSourceCache()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    } as never)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects input that is not a Tricount link or token', async () => {
    const caller = await makeCaller()
    await expect(
      caller.tricountPreview({ sourceUrl: 'https://example.com/x' }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns OK on a successful fetch and caches the parsed source', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => authPayload,
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => registryPayload,
      })
    const caller = await makeCaller()
    const first = await caller.tricountPreview({
      sourceUrl: 'https://tricount.com/tMjbqgwJxaikhUbkNz',
    })
    expect(first.kind).toBe('OK')
    if (first.kind !== 'OK') return
    expect(first.source.provider).toBe('TRICOUNT')
    expect(first.source.name).toBe('City trip')
    expect(first.source.expenses).toHaveLength(1)
    expect(getCachedSource('tricount:tMjbqgwJxaikhUbkNz')?.name).toBe(
      'City trip',
    )
    // Device registration must carry a real 2048-bit RSA public key
    // (PKCS#1 PEM) — the server 400s placeholder values.
    const authCall = fetchMock.mock.calls[0]
    expect(authCall?.[0]).toContain('/v1/session-registry-installation')
    const authBody = JSON.parse(authCall?.[1]?.body as string) as {
      client_public_key: string
    }
    expect(authBody.client_public_key).toMatch(
      /^-----BEGIN RSA PUBLIC KEY-----\n/,
    )

    const second = await caller.tricountPreview({
      sourceUrl: 'tMjbqgwJxaikhUbkNz',
    })
    expect(second.kind).toBe('OK')
    // Second call served from cache: still exactly two fetches total.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns NOT_FOUND when the registry is missing', async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => authPayload,
      })
      .mockResolvedValueOnce({ status: 404, ok: false })
    const caller = await makeCaller()
    const result = await caller.tricountPreview({
      sourceUrl: 'https://tricount.com/tMissing0000',
    })
    expect(result.kind).toBe('NOT_FOUND')
  })
})
