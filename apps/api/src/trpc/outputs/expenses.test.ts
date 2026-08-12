import { describe, expect, it } from 'vitest'

import {
  expenseGetResponseSchema,
  expenseListItemResponseSchema,
} from './expenses'

/**
 * Regression guard for "RangeError: invalid instant" on the expense edit form.
 *
 * `expenseAt` / `expenseTimeZone` were selected by the queries and spread into
 * the router responses, but were never declared on these output schemas. zod
 * strips undeclared keys, so tRPC silently deleted both fields from every
 * response that used them. The edit form reads `expense.expenseAt`
 * unconditionally, so it evaluated `new Date(undefined)` -> Invalid Date ->
 * `utcToWallTime()` threw.
 *
 * TypeScript could not catch it because the form asserted the fields with an
 * `as` cast. These tests assert the wire contract directly instead.
 */
describe('expense output schemas', () => {
  const timezoneAwareFields = ['expenseAt', 'expenseTimeZone'] as const

  it.each(timezoneAwareFields)(
    'expenseGetResponseSchema declares %s',
    (field) => {
      expect(Object.keys(expenseGetResponseSchema.shape)).toContain(field)
    },
  )

  it.each(timezoneAwareFields)(
    'expenseListItemResponseSchema declares %s',
    (field) => {
      expect(Object.keys(expenseListItemResponseSchema.shape)).toContain(field)
    },
  )

  it('preserves the timezone-aware fields through a parse', () => {
    const schema = expenseGetResponseSchema.pick({
      expenseAt: true,
      expenseTimeZone: true,
    })
    const expenseAt = new Date('2026-08-12T12:00:00.000Z')

    const parsed = schema.parse({
      expenseAt,
      expenseTimeZone: 'UTC',
      undeclaredField: 'should be stripped',
    })

    expect(parsed.expenseAt).toEqual(expenseAt)
    expect(parsed.expenseTimeZone).toBe('UTC')
    // Documents the exact zod behaviour that caused the incident: anything the
    // schema does not declare is dropped silently rather than rejected.
    expect(parsed).not.toHaveProperty('undeclaredField')
  })
})
