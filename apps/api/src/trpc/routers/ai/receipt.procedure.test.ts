import { beforeEach, describe, expect, it, vi } from 'vitest'

const envState = vi.hoisted(() => ({
  PUBLIC_ENABLE_RECEIPT_EXTRACT: false,
}))

vi.mock(import('../../../lib/env'), async (importOriginal) => {
  const actual = await importOriginal()
  const mockedEnv = { ...actual.env }
  Object.defineProperty(mockedEnv, 'PUBLIC_ENABLE_RECEIPT_EXTRACT', {
    enumerable: true,
    get: () => envState.PUBLIC_ENABLE_RECEIPT_EXTRACT,
  })
  return { ...actual, env: mockedEnv }
})

import { aiRouter } from '.'

beforeEach(() => {
  envState.PUBLIC_ENABLE_RECEIPT_EXTRACT = false
})

describe('receipt extraction authorization', () => {
  it('rejects anonymous requests before invoking receipt extraction', async () => {
    const caller = aiRouter.createCaller({ auth: null })

    await expect(
      caller.extractExpenseInformationFromImage({
        imageUrl: 'https://example.test/receipt.jpg',
        currency: '$',
        currencyCode: 'USD',
        groupId: 'group-1',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('enforces the server feature flag for authenticated requests', async () => {
    const caller = aiRouter.createCaller({
      auth: {
        session: { id: 'session-1' },
        user: {
          id: 'account-1',
          email: 'alice@example.test',
          emailVerified: true,
          name: 'Alice',
        },
      },
    } as never)

    await expect(
      caller.extractExpenseInformationFromImage({
        imageUrl: 'https://example.test/receipt.jpg',
        currency: '$',
        currencyCode: 'USD',
        groupId: 'group-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
