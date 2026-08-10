import { describe, expect, it } from 'vitest'

import {
  CREATE_OPERATIONS,
  deriveCreateToken,
  idempotencyRequestHash,
} from './idempotency'

describe('create idempotency primitives', () => {
  it('hashes semantically identical validated objects canonically', () => {
    expect(idempotencyRequestHash({ b: 2, a: { y: 2, x: 1 } })).toBe(
      idempotencyRequestHash({ a: { x: 1, y: 2 }, b: 2 }),
    )
    expect(idempotencyRequestHash({ amount: 100 })).not.toBe(
      idempotencyRequestHash({ amount: 101 }),
    )
  })

  it('derives stable domain-separated invitation tokens', () => {
    const base = {
      accountId: 'account-1',
      operation: CREATE_OPERATIONS.linkInvitation,
      requestId: '00000000-0000-4000-8000-000000000001',
      discriminator: 'invite-1',
    } as const
    expect(deriveCreateToken(base)).toBe(deriveCreateToken(base))
    expect(deriveCreateToken(base)).not.toBe(
      deriveCreateToken({ ...base, discriminator: 'invite-2' }),
    )
  })

  it('maintains an explicit operation for every shared create flow', () => {
    expect(Object.keys(CREATE_OPERATIONS).sort()).toEqual(
      [
        'budget',
        'emailInvitation',
        'expense',
        'expenseComment',
        'friendLedger',
        'group',
        'import',
        'linkInvitation',
        'participant',
        'subgroup',
      ].sort(),
    )
    expect(new Set(Object.values(CREATE_OPERATIONS)).size).toBe(
      Object.keys(CREATE_OPERATIONS).length,
    )
  })
})
