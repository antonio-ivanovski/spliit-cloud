import { describe, expect, it } from 'vitest'
import '../test/mocks'
import {
  PLACEHOLDER_EMAIL_DOMAIN,
  buildLinkPlaceholderEmail,
  buildProviderPlaceholderEmail,
  isPlaceholderEmail,
} from './invitations'

describe('isPlaceholderEmail', () => {
  it('returns true for any address under the placeholder.local domain', () => {
    expect(isPlaceholderEmail('abc-123@reddit.placeholder.local')).toBe(true)
    expect(isPlaceholderEmail('tok@link.placeholder.local')).toBe(true)
  })

  it('is case-insensitive on the domain', () => {
    expect(isPlaceholderEmail('abc@reddit.PLACEHOLDER.local')).toBe(true)
  })

  it('returns false for real addresses', () => {
    expect(isPlaceholderEmail('alice@example.com')).toBe(false)
    expect(isPlaceholderEmail('alice@placeholder.io')).toBe(false)
  })

  it('returns false for null/undefined/empty', () => {
    expect(isPlaceholderEmail(null)).toBe(false)
    expect(isPlaceholderEmail(undefined)).toBe(false)
    expect(isPlaceholderEmail('')).toBe(false)
  })
})

describe('buildProviderPlaceholderEmail', () => {
  it('produces <providerAccountId>@<provider>.placeholder.local', () => {
    expect(buildProviderPlaceholderEmail('reddit', 'abc-123')).toBe(
      'abc-123@reddit.placeholder.local',
    )
    expect(buildProviderPlaceholderEmail('discord', '987654321')).toBe(
      '987654321@discord.placeholder.local',
    )
  })

  it('lowercases and sanitizes the provider name', () => {
    expect(buildProviderPlaceholderEmail('Google', 'sub-1')).toBe(
      'sub-1@google.placeholder.local',
    )
    expect(buildProviderPlaceholderEmail('apple_id', 'sub-1')).toBe(
      'sub-1@apple-id.placeholder.local',
    )
  })

  it('always ends with the reserved domain', () => {
    const email = buildProviderPlaceholderEmail('reddit', 'x')
    expect(email.endsWith(`.${PLACEHOLDER_EMAIL_DOMAIN}`)).toBe(true)
    expect(isPlaceholderEmail(email)).toBe(true)
  })
})

describe('buildLinkPlaceholderEmail', () => {
  it('produces <token>@link.placeholder.local', () => {
    expect(buildLinkPlaceholderEmail('tok-abc-123')).toBe(
      'tok-abc-123@link.placeholder.local',
    )
  })

  it('always ends with the reserved domain', () => {
    const email = buildLinkPlaceholderEmail('whatever')
    expect(email.endsWith(`.${PLACEHOLDER_EMAIL_DOMAIN}`)).toBe(true)
    expect(isPlaceholderEmail(email)).toBe(true)
  })
})
