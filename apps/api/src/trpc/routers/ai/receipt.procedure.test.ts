import { describe, expect, it } from 'vitest'

import { aiRouter } from '.'

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
