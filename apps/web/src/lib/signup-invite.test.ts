import { describe, expect, it } from 'vitest'

import {
  extractLinkInviteTokenFromRedirect,
  hasSignupInviteProof,
  signupInviteFetchOptions,
} from './signup-invite'

describe('extractLinkInviteTokenFromRedirect', () => {
  it('reads the invite search param from a relative redirect', () => {
    expect(
      extractLinkInviteTokenFromRedirect(
        '/groups/grp-1?invite=abcDEF-_0123456789',
      ),
    ).toBe('abcDEF-_0123456789')
  })

  it('returns undefined when the redirect has no invite', () => {
    expect(extractLinkInviteTokenFromRedirect('/groups/grp-1')).toBeUndefined()
    expect(extractLinkInviteTokenFromRedirect(undefined)).toBeUndefined()
  })
})

describe('hasSignupInviteProof', () => {
  it('is true for an email invitation id or a link token in redirect', () => {
    expect(hasSignupInviteProof({ invitation: 'inv-1' })).toBe(true)
    expect(
      hasSignupInviteProof({
        redirect: '/groups/grp-1?invite=abcDEF-_0123456789',
      }),
    ).toBe(true)
    expect(hasSignupInviteProof({})).toBe(false)
  })
})

describe('signupInviteFetchOptions', () => {
  it('adds the invite header when a token is present', () => {
    expect(signupInviteFetchOptions('token-1')).toEqual({
      headers: { 'X-Spliit-Invite-Token': 'token-1' },
    })
    expect(signupInviteFetchOptions(undefined)).toEqual({})
  })
})
