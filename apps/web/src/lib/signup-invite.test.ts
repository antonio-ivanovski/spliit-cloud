import { describe, expect, it } from 'vitest'

import {
  buildAuthBounceSearch,
  hasSignupInviteProof,
  resolveAuthReturnContext,
  safeLocalReturnPath,
  signupInviteFetchOptions,
  splitAuthDestination,
} from './signup-invite'

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

  it('prefers structured params over a legacy redirect', () => {
    expect(
      hasSignupInviteProof({
        redirect: '/unrelated',
        invite: 'explicit-token',
      }),
    ).toBe(true)
  })
})

describe('buildAuthBounceSearch', () => {
  const writer = { writer: 'test', from: '/groups/grp-1' }

  it('emits structured params for an invite bounce', () => {
    expect(
      buildAuthBounceSearch({
        writer: 'test',
        from: '/groups/grp-1?invite=tok&tab=expenses',
      }),
    ).toEqual({ redirect: '/groups/grp-1?tab=expenses', invite: 'tok' })
  })

  it('emits a bare search for a self-bounce instead of redirect=/', () => {
    expect(buildAuthBounceSearch({ ...writer, from: '/' })).toEqual({})
    expect(
      buildAuthBounceSearch({ ...writer, from: '/?redirect=%2F' }),
    ).toEqual({})
  })

  it('keeps credentials on a / bounce instead of dropping them', () => {
    expect(buildAuthBounceSearch({ ...writer, from: '/?invite=tok' })).toEqual({
      invite: 'tok',
    })
  })

  it('lifts credentials out of a legacy nested redirect', () => {
    expect(
      buildAuthBounceSearch({
        ...writer,
        from: '/auth/complete-profile?redirect=%2Fgroups%2Fgrp-1%3Finvite%3Dtok',
      }),
    ).toEqual({ redirect: '/groups/grp-1', invite: 'tok' })
  })

  it('keeps an explicit param over a conflicting legacy one', () => {
    expect(
      buildAuthBounceSearch({
        ...writer,
        from: '/groups/grp-1?invite=stale',
        invite: 'fresh',
      }),
    ).toEqual({ redirect: '/groups/grp-1', invite: 'fresh' })
  })

  it('merges outer credentials when unwrapping a nested redirect', () => {
    // A lap can re-bounce an already-structured URL through a legacy nested
    // `redirect=`: the outer token is the live one and must not be dropped
    // in favor of the stale inner value.
    expect(
      buildAuthBounceSearch({
        ...writer,
        from: `/groups/grp-1?invite=outer&redirect=${encodeURIComponent('/groups/grp-1?invite=inner')}`,
      }),
    ).toEqual({ redirect: '/groups/grp-1', invite: 'outer' })
  })

  it('collapses a mangled doubled invite instead of propagating it', () => {
    // The `T?invite=T?invite=T…` shape from query-in-`to` navigation: the
    // sanitizer keeps the leading token run so the next bounce is stable.
    expect(
      buildAuthBounceSearch({
        ...writer,
        from: '/groups/grp-1?invite=tok%3Finvite%3Dtok',
      }),
    ).toEqual({ redirect: '/groups/grp-1', invite: 'tok' })
  })

  it('a bounce of a bounce is a fixed point', () => {
    const once = buildAuthBounceSearch({
      writer: 'test',
      from: '/groups/grp-1?invite=tok&tab=expenses#members',
    })
    // Simulate the serialized hop `/auth/complete-profile?<once>` bouncing
    // again: the second bounce must equal the first.
    const hop = `/auth/complete-profile?${new URLSearchParams(once).toString()}`
    expect(buildAuthBounceSearch({ writer: 'test', from: hop })).toEqual(once)
  })

  it('preserves non-credential search on the destination', () => {
    expect(
      buildAuthBounceSearch({
        ...writer,
        from: '/expenses?showSettlements=false',
      }),
    ).toEqual({ redirect: '/expenses?showSettlements=false' })
  })
})

describe('resolveAuthReturnContext', () => {
  it('rebuilds the destination from structured params', () => {
    expect(
      resolveAuthReturnContext({ redirect: '/groups/grp-1', invite: 'tok' }),
    ).toMatchObject({
      redirectTo: '/groups/grp-1?invite=tok',
      linkInviteToken: 'tok',
    })
  })

  it('falls back to a legacy nested redirect', () => {
    expect(
      resolveAuthReturnContext({
        redirect: '/groups/grp-1?invite=legacy-tok',
      }),
    ).toMatchObject({
      redirectTo: '/groups/grp-1?invite=legacy-tok',
      linkInviteToken: 'legacy-tok',
    })
  })

  it('unwraps a legacy nested bounce and keeps its hash', () => {
    const destination = '/groups/grp-1?invite=deep-token&tab=expenses#members'
    expect(
      resolveAuthReturnContext({
        redirect: `/auth/complete-profile?redirect=${encodeURIComponent(destination)}`,
      }),
    ).toMatchObject({
      redirectTo: destination,
      linkInviteToken: 'deep-token',
    })
  })

  it('recovers the bearer context from a stray nested redirect', () => {
    // A legacy bounce can carry the token nested under `redirect` on the
    // destination page itself: unwrapping it is the feature (bookmarks), not
    // a hole — the open-redirect boundary stays in safeLocalReturnPath.
    expect(
      resolveAuthReturnContext({
        redirect: '/other?redirect=%2Fgroups%2Fg1%3Finvite%3Dtoken',
      }),
    ).toMatchObject({
      redirectTo: '/groups/g1?invite=token',
      linkInviteToken: 'token',
    })
  })

  it.each([
    '/?redirect=https%3A%2F%2Fattacker.example%2Fgroups%2Fg1%3Finvite%3Dtoken',
    '/?redirect=%2F%2Fattacker.example%2Fgroups%2Fg1%3Finvite%3Dtoken',
  ])('rejects off-origin nested returns: %s', (redirect) => {
    expect(resolveAuthReturnContext({ redirect })).toMatchObject({
      redirectTo: '/',
      linkInviteToken: undefined,
    })
  })

  it('keeps explicit structured proof when the redirect collapses', () => {
    // A legacy bounce can carry a token-less `redirect` while the structured
    // `invite` param holds the real credential (the shed-token shape: the
    // destination collapsed mid-race but the URL still escrows the proof).
    // The destination collapses to `/`, but the proof must survive it.
    expect(
      resolveAuthReturnContext({
        redirect: '/?redirect=https%3A%2F%2Fattacker.example%2Fx',
        invite: 'escrowed-token',
      }),
    ).toMatchObject({
      redirectTo: '/',
      linkInviteToken: 'escrowed-token',
    })
  })

  it('resolves a bare home bounce to /', () => {
    expect(resolveAuthReturnContext({})).toMatchObject({
      redirectTo: '/',
      linkInviteToken: undefined,
    })
  })

  it('sanitizes a mangled doubled invite value', () => {
    expect(
      resolveAuthReturnContext({ invite: 'tok?invite=tok?invite=tok' }),
    ).toMatchObject({
      linkInviteToken: 'tok',
    })
  })

  it('round-trips a resolved destination without growth', () => {
    // resolve -> navigate (split to+search) -> bounce must not grow the
    // token: the serialized hop re-resolves to the same destination.
    const first = resolveAuthReturnContext({
      redirect: '/groups/grp-1',
      invite: 'tok',
    })
    expect(first.redirectTo).toBe('/groups/grp-1?invite=tok')
    const hop = buildAuthBounceSearch({
      writer: 'test',
      from: `/auth/complete-profile?${new URLSearchParams({ redirect: '/groups/grp-1', invite: 'tok' }).toString()}`,
    })
    const second = resolveAuthReturnContext({
      redirect: hop.redirect,
      invite: hop.invite,
    })
    expect(second.redirectTo).toBe(first.redirectTo)
    expect(second.linkInviteToken).toBe('tok')
  })
})

describe('splitAuthDestination', () => {
  it('splits pathname from search for TanStack-safe navigation', () => {
    expect(splitAuthDestination('/groups/grp-1?invite=tok#members')).toEqual({
      to: '/groups/grp-1',
      search: { invite: 'tok' },
      hash: 'members',
    })
  })

  it('preserves a tab deep-link hash through the split', () => {
    // The `#members` bounce (group-header invite tab) must survive the
    // post-auth navigation or the guest lands on the wrong tab.
    const split = splitAuthDestination(
      resolveAuthReturnContext({
        redirect: '/groups/grp-1#members',
        invite: 'tok',
      }).redirectTo,
    )
    expect(split).toEqual({
      to: '/groups/grp-1',
      search: { invite: 'tok' },
      hash: 'members',
    })
  })

  it('returns an empty search for a bare path', () => {
    expect(splitAuthDestination('/')).toEqual({
      to: '/',
      search: {},
      hash: undefined,
    })
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

describe('acceptance intent across auth returns', () => {
  it('collects intermediate credentials and intent without nesting the destination', () => {
    const nested =
      '/auth/complete-profile?invite=middle-token&viewKey=view-key&invitationAction=accept&redirect=' +
      encodeURIComponent('/groups/g1/expenses#members')
    const context = resolveAuthReturnContext({ redirect: nested })
    expect(context.linkInviteToken).toBe('middle-token')
    const target = new URL(context.redirectTo, 'https://spliit.test')
    expect(target.pathname).toBe('/groups/g1/expenses')
    expect(target.searchParams.get('invitationAction')).toBe('accept')
    expect(target.searchParams.get('viewKey')).toBe('view-key')
    expect(target.hash).toBe('#members')
    const bounce = buildAuthBounceSearch({
      writer: 'test',
      from: context.redirectTo,
    })
    expect(bounce.invitationAction).toBe('accept')
    expect(resolveAuthReturnContext(bounce).redirectTo).toBe(context.redirectTo)
  })
})
