import { describe, expect, it } from 'vitest'

import { needsAnonymousOnboarding, needsAccountOnboarding } from './account'

describe('needsAnonymousOnboarding', () => {
  it('is false for ordinary accounts', () => {
    expect(
      needsAnonymousOnboarding({
        isAnonymous: false,
        name: 'Alice',
        email: 'alice@example.com',
      }),
    ).toBe(false)
  })

  it('uses a missing display name as the first-run signal', () => {
    const email = 'guest@anonymous.placeholder.local'
    expect(
      needsAnonymousOnboarding({
        isAnonymous: true,
        name: email,
        email,
      }),
    ).toBe(true)
  })

  it('does not trap a returning anonymous account that already has a name', () => {
    expect(
      needsAnonymousOnboarding({
        isAnonymous: true,
        name: 'Guest',
        email: 'guest@anonymous.placeholder.local',
      }),
    ).toBe(false)
  })

  it('honors an explicit incomplete flag even when a name exists', () => {
    expect(
      needsAnonymousOnboarding({
        isAnonymous: true,
        anonymousOnboardingCompleted: false,
        name: 'Guest',
        email: 'guest@anonymous.placeholder.local',
      }),
    ).toBe(true)
  })

  it('honors an explicit complete flag', () => {
    const email = 'guest@anonymous.placeholder.local'
    expect(
      needsAnonymousOnboarding({
        isAnonymous: true,
        anonymousOnboardingCompleted: true,
        name: email,
        email,
      }),
    ).toBe(false)
  })
})

describe('needsAccountOnboarding', () => {
  it('is true when only a display name is missing', () => {
    expect(
      needsAccountOnboarding({
        name: '',
        email: 'alice@example.com',
      }),
    ).toBe(true)
  })
})
