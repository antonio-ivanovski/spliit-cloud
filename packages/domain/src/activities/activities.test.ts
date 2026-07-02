import { describe, expect, it } from 'vitest'
import {
  activityDataSchema,
  expenseActivityDataSchema,
  groupActivityDataSchema,
  invitationActivityDataSchema,
  memberActivityDataSchema,
  parseActivityData,
} from './payload'
import {
  activityActorTypeSchema,
  activitySubjectTypeSchema,
  activityTypeSchema,
} from './types'

describe('activityTypeSchema', () => {
  it('accepts every supported event value', () => {
    const values = [
      'EXPENSE_CREATED',
      'EXPENSE_UPDATED',
      'EXPENSE_DELETED',
      'GROUP_UPDATED',
      'GROUP_ARCHIVED',
      'GROUP_UNARCHIVED',
      'INVITATION_CREATED',
      'INVITATION_REVOKED',
      'INVITATION_ACCEPTED',
      'INVITATION_DECLINED',
      'MEMBER_LEFT',
      'MEMBER_REMOVED',
      'MEMBER_ROLE_CHANGED',
    ]
    for (const value of values) {
      expect(activityTypeSchema.safeParse(value).success).toBe(true)
    }
  })

  it('rejects the legacy enum names', () => {
    expect(activityTypeSchema.safeParse('CREATE_EXPENSE').success).toBe(false)
    expect(activityTypeSchema.safeParse('UPDATE_EXPENSE').success).toBe(false)
    expect(activityTypeSchema.safeParse('UPDATE_GROUP').success).toBe(false)
  })
})

describe('activityActorTypeSchema', () => {
  it('accepts ACCOUNT, LEDGER_PARTICIPANT, SYSTEM', () => {
    expect(activityActorTypeSchema.safeParse('ACCOUNT').success).toBe(true)
    expect(
      activityActorTypeSchema.safeParse('LEDGER_PARTICIPANT').success,
    ).toBe(true)
    expect(activityActorTypeSchema.safeParse('SYSTEM').success).toBe(true)
  })

  it('rejects unknown actor types', () => {
    expect(activityActorTypeSchema.safeParse('GUEST').success).toBe(false)
  })
})

describe('activitySubjectTypeSchema', () => {
  it('accepts EXPENSE, GROUP, MEMBER, INVITATION, LEDGER_PARTICIPANT', () => {
    for (const value of [
      'EXPENSE',
      'GROUP',
      'MEMBER',
      'INVITATION',
      'LEDGER_PARTICIPANT',
    ]) {
      expect(activitySubjectTypeSchema.safeParse(value).success).toBe(true)
    }
  })
})

describe('expenseActivityDataSchema', () => {
  it('accepts a minimal expense payload', () => {
    const result = expenseActivityDataSchema.safeParse({
      kind: 'expense',
      summary: 'Dinner',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a full expense payload with changed fields', () => {
    const result = expenseActivityDataSchema.safeParse({
      kind: 'expense',
      title: 'Dinner',
      amount: 4500,
      currencyCode: 'USD',
      date: '2026-01-01',
      summary: 'Dinner',
      changedFields: ['title', 'amount', 'split'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-integer amount', () => {
    const result = expenseActivityDataSchema.safeParse({
      kind: 'expense',
      amount: 4.5,
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown changed-field keys', () => {
    const result = expenseActivityDataSchema.safeParse({
      kind: 'expense',
      changedFields: ['nope'],
    })
    expect(result.success).toBe(false)
  })
})

describe('groupActivityDataSchema', () => {
  it('accepts a group payload with changed fields', () => {
    const result = groupActivityDataSchema.safeParse({
      kind: 'group',
      summary: 'Trip',
      changedFields: ['name', 'currency'],
    })
    expect(result.success).toBe(true)
  })
})

describe('memberActivityDataSchema', () => {
  it('accepts role change metadata', () => {
    const result = memberActivityDataSchema.safeParse({
      kind: 'member',
      displayName: 'Alice',
      previousRole: 'MEMBER',
      nextRole: 'ADMIN',
      targetDisplayName: 'Alice',
    })
    expect(result.success).toBe(true)
  })
})

describe('invitationActivityDataSchema', () => {
  it('accepts an EMAIL invitation payload', () => {
    const result = invitationActivityDataSchema.safeParse({
      kind: 'invitation',
      displayLabel: 'Bob',
      invitationType: 'EMAIL',
      role: 'MEMBER',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a LINK invitation payload', () => {
    const result = invitationActivityDataSchema.safeParse({
      kind: 'invitation',
      displayLabel: 'Anyone',
      invitationType: 'LINK',
      role: 'MEMBER',
    })
    expect(result.success).toBe(true)
  })
})

describe('activityDataSchema (discriminated union)', () => {
  it('rejects an invalid discriminator value', () => {
    const result = activityDataSchema.safeParse({
      kind: 'expense',
      amount: 'not-a-number',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown kind', () => {
    const result = activityDataSchema.safeParse({ kind: 'whatever' })
    expect(result.success).toBe(false)
  })

  it('rejects when kind is missing', () => {
    expect(activityDataSchema.safeParse({}).success).toBe(false)
  })
})

describe('parseActivityData', () => {
  it('returns null for null', () => {
    expect(parseActivityData(null)).toBe(null)
  })

  it('returns null for undefined', () => {
    expect(parseActivityData(undefined)).toBe(null)
  })

  it('returns null for non-object inputs', () => {
    expect(parseActivityData('hello')).toBe(null)
    expect(parseActivityData(123)).toBe(null)
    expect(parseActivityData(true)).toBe(null)
  })

  it('returns null for {}', () => {
    expect(parseActivityData({})).toBe(null)
  })

  it('returns null for invalid payloads', () => {
    expect(parseActivityData({ kind: 'expense', amount: 'x' })).toBe(null)
  })

  it('returns the parsed payload for valid inputs', () => {
    const parsed = parseActivityData({
      kind: 'expense',
      summary: 'Dinner',
      amount: 4500,
      changedFields: ['title', 'amount', 'split'],
    })
    expect(parsed).toEqual({
      kind: 'expense',
      summary: 'Dinner',
      amount: 4500,
      changedFields: ['title', 'amount', 'split'],
    })
  })

  it('returns null for valid shape but invalid discriminator', () => {
    expect(parseActivityData({ kind: 'unknown' })).toBe(null)
  })

  it('returns null when given a non-discriminated object', () => {
    expect(parseActivityData({ summary: 'no kind' })).toBe(null)
  })
})
