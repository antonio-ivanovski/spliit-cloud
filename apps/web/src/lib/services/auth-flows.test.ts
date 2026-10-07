import { Deferred, Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeAuthFlows, type AuthFlowDeps } from './auth-flows'

// Authoring gate (test-audit): this file owns auth sequencing — genuine
// successes mark install eligibility and route post-auth (profile completion
// vs return target), failures map to the current UI codes without marking,
// passkey cancellation stays silent, social marks before the redirect, and
// concurrent identical submits share one SDK execution. Regression: a
// restored session marking eligibility would nag remembered logins; a
// double-clicked sign-in double-POSTing credentials could lock the account;
// a cancelled passkey alarming as a failure would cry wolf. SDK payload
// shapes stay owned by better-auth boundary tests; this file owns the
// Effect sequencing around the injected SDK seams.

const ROUTES = {
  redirectTo: '/groups',
  completeProfilePath: '/auth/complete-profile?redirect=%2Fgroups',
}

function harness(overrides?: Partial<AuthFlowDeps>) {
  const calls: string[] = []
  let eligible = 0
  const navigated: string[] = []
  const service = makeAuthFlows({
    signInEmail: () => {
      calls.push('signInEmail')
      return Promise.resolve({ error: null })
    },
    signUpEmail: () => {
      calls.push('signUpEmail')
      return Promise.resolve({ error: null })
    },
    sendMagicLink: () => {
      calls.push('magicLink')
      return Promise.resolve({ error: null })
    },
    signInPasskey: () => {
      calls.push('passkey')
      return Promise.resolve({ error: null })
    },
    signInSocial: (input) => {
      calls.push('social:' + input.provider)
      return new Promise<unknown>(() => undefined)
    },
    signInAnonymous: () => {
      calls.push('anonymous')
      return Promise.resolve({ error: null })
    },
    markEligible: () => {
      eligible += 1
    },
    verifySession: () => Promise.resolve(),
    getAccount: () => Promise.resolve({ needsProfile: false }),
    navigate: (href) => {
      navigated.push(href)
    },
    ...overrides,
  })
  return { service, calls, navigated, eligibleCount: () => eligible }
}

describe('password flows', () => {
  it('routes a verified sign-in to the return target and marks eligibility', async () => {
    const { service, navigated, eligibleCount } = harness()
    const result = await Effect.runPromise(
      service.signInWithPassword(
        { email: 'a@example.com', password: 'secret123!' },
        ROUTES,
      ),
    )
    expect(result).toEqual({ ok: true, next: 'continue' })
    expect(navigated).toEqual(['/groups'])
    expect(eligibleCount()).toBe(1)
  })

  it('routes to profile completion when the display name is missing', async () => {
    const { service, navigated } = harness({
      getAccount: () => Promise.resolve({ needsProfile: true }),
    })
    await Effect.runPromise(
      service.signInWithPassword(
        { email: 'a@example.com', password: 'secret123!' },
        ROUTES,
      ),
    )
    expect(navigated).toEqual([ROUTES.completeProfilePath])
  })

  it('maps sign-in errors without marking eligibility or navigating', async () => {
    const { service, navigated, eligibleCount } = harness({
      signInEmail: () =>
        Promise.resolve({ error: { code: 'INVALID_CREDENTIALS' } }),
    })
    const result = await Effect.runPromise(
      service.signInWithPassword(
        { email: 'a@example.com', password: 'nope' },
        ROUTES,
      ),
    )
    expect(result).toEqual({ ok: false, code: 'invalidCredentials' })
    expect(navigated).toEqual([])
    expect(eligibleCount()).toBe(0)
  })

  it('validates sign-up policy locally with current codes', async () => {
    const { service, eligibleCount } = harness()
    expect(
      await Effect.runPromise(
        service.signUpWithPassword({
          email: 'a@example.com',
          password: 'weak',
          callbackURL: 'http://x/cb',
        }),
      ),
    ).toEqual({ ok: false, code: 'passwordPolicy' })
    expect(
      await Effect.runPromise(
        service.signUpWithPassword({
          email: 'a@example.com',
          password: 'StrongPass123!',
          confirmPassword: 'Other123!',
          callbackURL: 'http://x/cb',
        }),
      ),
    ).toEqual({ ok: false, code: 'passwordMismatch' })
    expect(eligibleCount()).toBe(0)
  })

  it('maps invite-required and taken emails with current codes', async () => {
    const invite = harness({
      signUpEmail: () =>
        Promise.resolve({ error: { code: 'SIGNUP_INVITE_REQUIRED' } }),
    })
    expect(
      await Effect.runPromise(
        invite.service.signUpWithPassword({
          email: 'a@example.com',
          password: 'StrongPass123!',
          callbackURL: 'http://x/cb',
        }),
      ),
    ).toEqual({ ok: false, code: 'signupInviteRequired' })
    const taken = harness({
      signUpEmail: () =>
        Promise.resolve({ error: { message: 'email already in use' } }),
    })
    expect(
      await Effect.runPromise(
        taken.service.signUpWithPassword({
          email: 'a@example.com',
          password: 'StrongPass123!',
          callbackURL: 'http://x/cb',
        }),
      ),
    ).toEqual({ ok: false, code: 'invalidCredentials' })
  })

  it('shares one execution across concurrent identical submits', async () => {
    const gate = await Effect.runPromise(
      Deferred.make<{ readonly error?: null }>(),
    )
    const gateCalls: string[] = []
    const { service } = harness({
      signInEmail: () => {
        gateCalls.push('signInEmail')
        return Effect.runPromise(Deferred.await(gate))
      },
    })
    const program = Effect.gen(function* () {
      const first = yield* Effect.forkChild(
        service.signInWithPassword(
          { email: 'a@example.com', password: 'secret123!' },
          ROUTES,
        ),
      )
      const second = yield* Effect.forkChild(
        service.signInWithPassword(
          { email: 'a@example.com', password: 'secret123!' },
          ROUTES,
        ),
      )
      yield* Effect.sleep(10)
      yield* Deferred.succeed(gate, { error: null })
      const a = yield* Fiber.join(first)
      const b = yield* Fiber.join(second)
      return [a, b] as const
    })
    const [a, b] = await Effect.runPromise(program)
    expect(a).toEqual({ ok: true, next: 'continue' })
    expect(b).toEqual({ ok: true, next: 'continue' })
    expect(gateCalls).toHaveLength(1)
  })
})

describe('magic link and passkey', () => {
  it('requires an email and marks eligibility on send', async () => {
    const { service, eligibleCount } = harness()
    expect(
      await Effect.runPromise(
        service.signInWithMagicLink({
          email: '  ',
          callbackURL: 'http://x/',
          newUserCallbackURL: 'http://x/n',
        }),
      ),
    ).toEqual({ ok: false, code: 'emailRequired' })
    expect(eligibleCount()).toBe(0)
    const sent = await Effect.runPromise(
      service.signInWithMagicLink({
        email: 'a@example.com',
        callbackURL: 'http://x/',
        newUserCallbackURL: 'http://x/n',
      }),
    )
    expect(sent).toEqual({ ok: true, next: 'verify' })
    expect(eligibleCount()).toBe(1)
  })

  it('keeps passkey cancellation silent and failures typed', async () => {
    const cancelled = harness({
      signInPasskey: () =>
        Promise.resolve({ error: { code: 'AuthCancelled' } }),
    })
    expect(
      await Effect.runPromise(cancelled.service.signInWithPasskey(ROUTES)),
    ).toEqual({
      ok: false,
      code: 'passkeyCancelled',
    })
    expect(cancelled.eligibleCount()).toBe(0)
    const failed = harness({
      signInPasskey: () => Promise.resolve({ error: { code: 'NOT_ALLOWED' } }),
    })
    expect(
      await Effect.runPromise(failed.service.signInWithPasskey(ROUTES)),
    ).toEqual({
      ok: false,
      code: 'passkeyFailed',
    })
  })
})

describe('social and anonymous', () => {
  it('marks eligibility before leaving for the OAuth round-trip', async () => {
    const { service, calls, eligibleCount } = harness()
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        service.signInWithSocial({
          provider: 'google',
          callbackURL: 'http://x/cb',
        }),
      )
      yield* Effect.sleep(10)
      yield* Fiber.interrupt(fiber)
      return yield* Effect.exit(Fiber.join(fiber))
    })
    await Effect.runPromiseExit(program)
    expect(calls).toEqual(['social:google'])
    expect(eligibleCount()).toBe(1)
  })

  it('sequences anonymous sign-in through post-auth', async () => {
    const { service, navigated, eligibleCount } = harness()
    const result = await Effect.runPromise(service.signInAnonymous(ROUTES))
    expect(result).toEqual({ ok: true, next: 'continue' })
    expect(navigated).toEqual(['/groups'])
    expect(eligibleCount()).toBe(1)
  })
})

describe('account commands', () => {
  it('passes server codes through for single-step operations', async () => {
    const failing = harness({
      runCommand: () =>
        Promise.reject(
          Object.assign(new Error('weak'), { code: 'PASSWORD_POLICY' }),
        ),
    })
    expect(
      await Effect.runPromise(
        failing.service.runAccountCommand('password:change', {}),
      ),
    ).toEqual({
      ok: false,
      code: 'PASSWORD_POLICY',
    })
    const passing = harness({
      runCommand: () => Promise.resolve({ sent: true }),
    })
    expect(
      await Effect.runPromise(
        passing.service.runAccountCommand('email:request', {}),
      ),
    ).toEqual({ ok: true })
  })
})
