import { describe, expect, it } from 'vitest'

import {
  extractLinkInviteTokenFromRedirect,
  hasSignupInviteProof,
  resolveAuthReturnContext,
  safeLocalReturnPath,
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

  it('reads an invite through bounded profile-completion redirects', () => {
    const destination = '/groups/grp-1?invite=deep-token&tab=expenses'
    const redirect = `/auth/complete-profile?redirect=${encodeURIComponent(
      `/auth/complete-profile?redirect=${encodeURIComponent(destination)}`,
    )}`

    expect(extractLinkInviteTokenFromRedirect(redirect)).toBe('deep-token')
    expect(resolveAuthReturnContext({ redirect })).toMatchObject({
      redirectTo: redirect,
      destination,
      linkInviteToken: 'deep-token',
    })
  })
})

describe('safeLocalReturnPath', () => {
  it('preserves local path, search, and hash', () => {
    expect(safeLocalReturnPath('/groups/g1?invite=token#members')).toBe(
      '/groups/g1?invite=token#members',
    )
  })

  it('rejects absolute and protocol-relative destinations', () => {
    expect(safeLocalReturnPath('https://attacker.example/groups/g1')).toBe('/')
    expect(safeLocalReturnPath('//attacker.example/groups/g1')).toBe('/')
  })

  it.each([
    '/safe/..//attacker.example',
    '/safe/%2e%2e//attacker.example/path?invite=token#members',
  ])(
    'rejects paths that normalize to protocol-relative URLs: %s',
    (redirect) => {
      expect(safeLocalReturnPath(redirect)).toBe('/')
      expect(safeLocalReturnPath(redirect, '/groups')).toBe('/groups')
      expect(resolveAuthReturnContext({ redirect })).toMatchObject({
        redirectTo: '/',
        destination: '/',
        linkInviteToken: undefined,
      })
    },
  )
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

  it('uses an explicit embedded-panel destination', () => {
    expect(
      hasSignupInviteProof({
        redirect: '/unrelated',
        redirectTo: '/groups/grp-1?invite=explicit-token',
      }),
    ).toBe(true)
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
