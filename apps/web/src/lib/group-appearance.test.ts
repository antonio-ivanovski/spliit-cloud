import { describe, expect, it } from 'vitest'

import {
  groupAccentStyle,
  resolveGroupColor,
  shouldOfferGroupEmojiIntro,
} from './group-appearance'

const eligibleIntro = {
  isLoading: false,
  groupType: 'GROUP' as const,
  archived: false,
  groupName: '🏝️ Island Trip',
  groupEmoji: null,
  currentMemberRole: 'ADMIN' as const,
  viewerAccess: 'READ_WRITE' as const,
}

describe('shouldOfferGroupEmojiIntro', () => {
  it('offers the intro to admins of an undecided group with a title emoji', () => {
    expect(shouldOfferGroupEmojiIntro(eligibleIntro)).toBe(true)
  })

  it('never offers when the emoji was picked or explicitly declined', () => {
    expect(
      shouldOfferGroupEmojiIntro({ ...eligibleIntro, groupEmoji: '🎉' }),
    ).toBe(false)
    expect(
      shouldOfferGroupEmojiIntro({ ...eligibleIntro, groupEmoji: '' }),
    ).toBe(false)
  })

  it('requires an emoji in the name', () => {
    expect(
      shouldOfferGroupEmojiIntro({
        ...eligibleIntro,
        groupName: 'Island Trip',
      }),
    ).toBe(false)
  })

  it('excludes friend ledgers, archived groups, members, and read-only viewers', () => {
    expect(
      shouldOfferGroupEmojiIntro({ ...eligibleIntro, groupType: 'FRIEND' }),
    ).toBe(false)
    expect(
      shouldOfferGroupEmojiIntro({ ...eligibleIntro, archived: true }),
    ).toBe(false)
    expect(
      shouldOfferGroupEmojiIntro({
        ...eligibleIntro,
        currentMemberRole: 'MEMBER',
      }),
    ).toBe(false)
    expect(
      shouldOfferGroupEmojiIntro({
        ...eligibleIntro,
        viewerAccess: 'READ_ONLY',
      }),
    ).toBe(false)
  })

  it('stays quiet while loading or without a group', () => {
    expect(
      shouldOfferGroupEmojiIntro({ ...eligibleIntro, isLoading: true }),
    ).toBe(false)
    expect(
      shouldOfferGroupEmojiIntro({
        ...eligibleIntro,
        groupName: undefined,
        groupType: undefined,
      }),
    ).toBe(false)
  })
})

describe('group accent styling', () => {
  it('narrows palette ids, custom hex, and rejects unknown values', () => {
    expect(resolveGroupColor('teal')).toBe('teal')
    expect(resolveGroupColor('#A1B2C3')).toBe('#a1b2c3')
    expect(resolveGroupColor('chartreuse')).toBeNull()
    expect(resolveGroupColor(null)).toBeNull()
    expect(resolveGroupColor(undefined)).toBeNull()
  })

  it('exposes the resolved accent hex as a CSS custom property', () => {
    expect(groupAccentStyle('teal')).toEqual({ '--group-accent': '#14b8a6' })
    expect(groupAccentStyle('#a1b2c3')).toEqual({
      '--group-accent': '#a1b2c3',
    })
  })

  it('returns no accent style for missing or unknown colors', () => {
    expect(groupAccentStyle('chartreuse')).toBeNull()
    expect(groupAccentStyle(null)).toBeNull()
    expect(groupAccentStyle(undefined)).toBeNull()
  })
})
