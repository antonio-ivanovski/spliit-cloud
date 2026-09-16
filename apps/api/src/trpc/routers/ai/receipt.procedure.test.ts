import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../../test/mocks'
import { prismaMock } from '../../../test/state'

const envState = vi.hoisted(() => ({
  PUBLIC_ENABLE_RECEIPT_EXTRACT: false,
  AI_RECEIPT_TIMEOUT_SECONDS: 120,
}))

const extractExpenseInformationFromImage = vi.hoisted(() => vi.fn())

vi.mock(import('../../../lib/env'), async (importOriginal) => {
  const actual = await importOriginal()
  const mockedEnv = { ...actual.env }
  for (const key of Object.keys(envState) as (keyof typeof envState)[]) {
    Object.defineProperty(mockedEnv, key, {
      enumerable: true,
      configurable: true,
      get: () => envState[key],
    })
  }
  return { ...actual, env: mockedEnv }
})

vi.mock(import('../../../lib/receipt-actions'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    extractExpenseInformationFromImage,
  }
})

import { aiRouter } from '.'

function authenticatedCaller() {
  return aiRouter.createCaller({
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
}

const scanInput = {
  imageUrl: 'https://example.test/receipt.jpg',
  currency: '$',
  currencyCode: 'USD',
  groupId: 'group-1',
}

beforeEach(() => {
  envState.PUBLIC_ENABLE_RECEIPT_EXTRACT = false
  extractExpenseInformationFromImage.mockReset()
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'group-1',
    ledger: { id: 'ledger-1', currency: '$', currencyCode: 'USD' },
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue({
    status: 'ACTIVE',
  } as never)
  prismaMock.expense.findMany.mockResolvedValue([])
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
    const caller = authenticatedCaller()

    await expect(
      caller.extractExpenseInformationFromImage({
        imageUrl: 'https://example.test/receipt.jpg',
        currency: '$',
        currencyCode: 'USD',
        groupId: 'group-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('maps provider timeouts to a TIMEOUT error instead of hanging silently', async () => {
    envState.PUBLIC_ENABLE_RECEIPT_EXTRACT = true
    extractExpenseInformationFromImage.mockRejectedValueOnce(
      new DOMException('total timeout of 120000ms exceeded', 'TimeoutError'),
    )
    const caller = authenticatedCaller()

    await expect(
      caller.extractExpenseInformationFromImage(scanInput),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'Receipt scanning failed due to timeout after 120s',
    })
  })

  it('lets non-timeout provider errors propagate unchanged', async () => {
    envState.PUBLIC_ENABLE_RECEIPT_EXTRACT = true
    extractExpenseInformationFromImage.mockRejectedValueOnce(
      new Error('AI service unavailable'),
    )
    const caller = authenticatedCaller()

    await expect(
      caller.extractExpenseInformationFromImage(scanInput),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
  })
})
