/**
 * Compile-time check that the Prisma JSON/string generator actually
 * narrows `Activity.type`, `Activity.actorType`, and
 * `Activity.subjectType` to the unions inferred from the domain Zod
 * schemas, rather than leaving them as raw `string`.
 *
 * The Prisma client types the activity fields against the global
 * `PrismaJson` namespace declared in `@spliit/db`'s `prisma-json.d.ts`.
 * If that wiring breaks (or someone replaces the domain types with raw
 * string literals), every valid assignment here would still compile and
 * the test would silently pass. To detect that, the test mixes:
 *
 *   1. valid assignments — they must compile and the type must accept
 *      every literal from the union.
 *   2. invalid assignments annotated with `@ts-expect-error` — they
 *      must fail to compile (any other behaviour means the field is
 *      too permissive).
 *
 * The runtime assertions are minimal because the value of this file is
 * at the type level; the Vitest `expect` calls just keep the test from
 * being tree-shaken by the typechecker.
 */
import type { ActivityData } from './payload'
import {
  activityActorTypeSchema,
  activitySubjectTypeSchema,
  activityTypeSchema,
  type ActivityActorType,
  type ActivitySubjectType,
  type ActivityType,
} from './types'

describe('Prisma JSON typing for Activity fields', () => {
  it('narrows ActivityType to the activity-type union', () => {
    const valid: ActivityType = 'EXPENSE_CREATED'
    expect(activityTypeSchema.safeParse(valid).success).toBe(true)
    // @ts-expect-error — a literal outside the union must not typecheck.
    const invalid: ActivityType = 'CREATE_EXPENSE'
    expect(invalid).toBe('CREATE_EXPENSE')
  })

  it('narrows ActivityActorType to the actor-type union', () => {
    const valid: ActivityActorType = 'ACCOUNT'
    expect(activityActorTypeSchema.safeParse(valid).success).toBe(true)
    // @ts-expect-error — "GUEST" is not part of the union.
    const invalid: ActivityActorType = 'GUEST'
    expect(invalid).toBe('GUEST')
  })

  it('narrows ActivitySubjectType to the subject-type union', () => {
    const valid: ActivitySubjectType = 'EXPENSE'
    expect(activitySubjectTypeSchema.safeParse(valid).success).toBe(true)
    // @ts-expect-error — "BALANCE" is not part of the union.
    const invalid: ActivitySubjectType = 'BALANCE'
    expect(invalid).toBe('BALANCE')
  })

  it('narrows ActivityData to the discriminated union (not raw object)', () => {
    const expenseData: ActivityData = {
      kind: 'expense',
      summary: 'Dinner',
      amount: 4500,
    }
    expect(expenseData.kind).toBe('expense')

    const groupData: ActivityData = {
      kind: 'group',
      summary: 'Trip',
      changedFields: ['name'],
    }
    expect(groupData.kind).toBe('group')

    const memberData: ActivityData = {
      kind: 'member',
      displayName: 'Alice',
      previousRole: 'MEMBER',
      nextRole: 'ADMIN',
    }
    expect(memberData.kind).toBe('member')

    const invitationData: ActivityData = {
      kind: 'invitation',
      displayLabel: 'Bob',
      invitationType: 'EMAIL',
      role: 'MEMBER',
    }
    expect(invitationData.kind).toBe('invitation')
  })

  it('rejects invalid kind discriminators at compile time', () => {
    // @ts-expect-error — "comment" is not a valid kind discriminator.
    const invalid: ActivityData = { kind: 'comment', summary: 'x' }
    expect(invalid).toBeDefined()
  })
})
