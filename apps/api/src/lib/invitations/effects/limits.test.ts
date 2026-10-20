import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { InviteValidationError } from './errors'
import {
  SHARED_LINK_LABEL_MAX_LENGTH,
  SHARED_LINK_MAX_TTL_MS,
  SHARED_LINK_MAX_USES_LIMIT,
  SHARED_LINK_MIN_TTL_MS,
  SHARED_LINK_MIN_USES,
  validateSharedLinkLimits,
  validateSharedLinkLimitsEffect,
} from './limits'

const run = <A>(effect: Effect.Effect<A, InviteValidationError>) =>
  Effect.runPromise(effect)
const flip = <A>(effect: Effect.Effect<A, InviteValidationError>) =>
  Effect.runPromise(Effect.flip(effect))

describe('validateSharedLinkLimitsEffect', () => {
  it('normalises absent and blank fields to null', async () => {
    expect(await run(validateSharedLinkLimitsEffect({}))).toEqual({
      label: null,
      maxUses: null,
      ttlMs: null,
    })
    expect(await run(validateSharedLinkLimitsEffect({ label: '   ' }))).toEqual(
      { label: null, maxUses: null, ttlMs: null },
    )
  })

  it('trims the label and validates the bounds', async () => {
    expect(
      await run(
        validateSharedLinkLimitsEffect({
          label: '  Family chat  ',
          maxUses: SHARED_LINK_MIN_USES,
          ttlMs: SHARED_LINK_MIN_TTL_MS,
        }),
      ),
    ).toEqual({
      label: 'Family chat',
      maxUses: SHARED_LINK_MIN_USES,
      ttlMs: SHARED_LINK_MIN_TTL_MS,
    })
  })

  it('rejects a label over the max length with the user message', async () => {
    const error = await flip(
      validateSharedLinkLimitsEffect({
        label: 'x'.repeat(SHARED_LINK_LABEL_MAX_LENGTH + 1),
      }),
    )
    expect(error).toBeInstanceOf(InviteValidationError)
    expect(error.message).toContain(String(SHARED_LINK_LABEL_MAX_LENGTH))
  })

  it('rejects join caps outside [min, max]', async () => {
    for (const maxUses of [
      SHARED_LINK_MIN_USES - 1,
      SHARED_LINK_MAX_USES_LIMIT + 1,
      2.5,
    ]) {
      const error = await flip(validateSharedLinkLimitsEffect({ maxUses }))
      expect(error).toBeInstanceOf(InviteValidationError)
      expect(error.message).toMatch(/join limit/i)
    }
    // The bounds themselves are valid.
    expect(
      (
        await run(
          validateSharedLinkLimitsEffect({
            maxUses: SHARED_LINK_MAX_USES_LIMIT,
          }),
        )
      ).maxUses,
    ).toBe(SHARED_LINK_MAX_USES_LIMIT)
  })

  it('rejects TTLs outside [1 hour, 1 year]', async () => {
    const short = await flip(
      validateSharedLinkLimitsEffect({ ttlMs: SHARED_LINK_MIN_TTL_MS - 1 }),
    )
    expect(short.message).toMatch(/1 hour and 1 year/)
    const long = await flip(
      validateSharedLinkLimitsEffect({ ttlMs: SHARED_LINK_MAX_TTL_MS + 1 }),
    )
    expect(long.message).toMatch(/1 hour and 1 year/)
  })

  it('the sync wrapper enforces the same schema', () => {
    expect(validateSharedLinkLimits({})).toEqual({
      label: null,
      maxUses: null,
      ttlMs: null,
    })
    expect(() =>
      validateSharedLinkLimits({ maxUses: SHARED_LINK_MIN_USES - 1 }),
    ).toThrowError(InviteValidationError)
  })
})
