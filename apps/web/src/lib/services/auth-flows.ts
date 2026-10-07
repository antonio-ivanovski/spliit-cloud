import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
} from 'effect'

import { isStrongPassword } from '@spliit/domain/password'

/**
 * Auth workflow service (Task 7).
 *
 * SDK adapters + guarded multi-step sequencing for OAuth consent, password,
 * email (magic link), anonymous recovery, and post-auth continuation.
 * Components keep presentation, route/form interaction, and command dispatch;
 * this service owns Effect composition:
 *
 * - No generic queue for redirects/non-idempotent requests: each flow runs under
 *   a single-flight gate keyed by flow. Concurrent identical submits share one
 *   execution instead of double-POSTing credentials or opening two OAuth
 *   round-trips.
 * - Post-auth sequencing is shared: record tab eligibility (install promotion),
 *   best-effort fresh session verification, read the account, then route to
 *   profile completion when a display name is missing, otherwise to the return
 *   target. Restored/background sessions never pass through here, so they can
 *   never mark eligibility.
 * - Passkey cancellation stays silent (passkeyCancelled); every other SDK failure
 *   maps to the current UI outcome codes — no new user-facing copy.
 * - Single-step account operations (password set/change/remove, email change
 *   request/confirm, anonymous recovery) are guarded commands with server-code
 *   passthrough; their UI mapping stays in the components.
 *
 * Better-auth SDK calls stay behind injected boundaries (the components pass
 * their client); the service never imports the client directly.
 */

export type AuthFailureCode =
  | 'invalidCredentials'
  | 'passwordPolicy'
  | 'passwordMismatch'
  | 'signupInviteRequired'
  | 'emailRequired'
  | 'magicLinkFailed'
  | 'passkeyFailed'
  | 'passkeyCancelled'
  | 'generic'

export type AuthResult =
  | { readonly ok: true; readonly next: 'continue' | 'verify' }
  | { readonly ok: false; readonly code: AuthFailureCode }

export type CommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string }

export interface SdkError {
  readonly code?: string
  readonly message?: string
}

export interface AuthAccountInfo {
  readonly needsProfile: boolean
}

export interface AuthFlowDeps {
  readonly signInEmail?: (
    input: { readonly email: string; readonly password: string },
    signal: AbortSignal,
  ) => Promise<{ readonly error?: SdkError | null }>
  readonly signUpEmail?: (
    input: {
      readonly email: string
      readonly password: string
      readonly callbackURL: string
    },
    signal: AbortSignal,
  ) => Promise<{ readonly error?: SdkError | null }>
  readonly sendMagicLink?: (
    input: {
      readonly email: string
      readonly callbackURL: string
      readonly newUserCallbackURL: string
    },
    signal: AbortSignal,
  ) => Promise<{ readonly error?: SdkError | null }>
  readonly signInPasskey?: (
    signal: AbortSignal,
  ) => Promise<{ readonly error?: SdkError | null }>
  readonly signInSocial?: (
    input: { readonly provider: string; readonly callbackURL: string },
    signal: AbortSignal,
  ) => Promise<unknown>
  readonly signInAnonymous?: (
    signal: AbortSignal,
  ) => Promise<{ readonly error?: SdkError | null }>
  /** Single-step account operation (password/email/recovery endpoints). */
  readonly runCommand?: (
    key: string,
    input: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>
  readonly isStrongPassword?: (password: string) => boolean
  /** Tab eligibility for install promotion (genuine success only). */
  readonly markEligible?: () => void
  /** Best-effort fresh verification after success. */
  readonly verifySession?: (signal: AbortSignal) => Promise<unknown>
  readonly getAccount?: (signal: AbortSignal) => Promise<AuthAccountInfo | null>
  readonly navigate?: (href: string) => void | Promise<unknown>
}

export interface PasswordCredentials {
  readonly email: string
  readonly password: string
  readonly confirmPassword?: string
}

export interface AuthFlows {
  readonly signInWithPassword: (
    credentials: PasswordCredentials,
    routes: {
      readonly redirectTo: string
      readonly completeProfilePath: string
    },
  ) => Effect.Effect<AuthResult>
  readonly signUpWithPassword: (
    credentials: PasswordCredentials & { readonly callbackURL: string },
  ) => Effect.Effect<AuthResult>
  readonly signInWithMagicLink: (input: {
    readonly email: string
    readonly callbackURL: string
    readonly newUserCallbackURL: string
  }) => Effect.Effect<AuthResult>
  readonly signInWithPasskey: (routes: {
    readonly redirectTo: string
    readonly completeProfilePath: string
  }) => Effect.Effect<AuthResult>
  readonly signInWithSocial: (input: {
    readonly provider: string
    readonly callbackURL: string
  }) => Effect.Effect<void>
  readonly signInAnonymous: (routes: {
    readonly redirectTo: string
    readonly completeProfilePath: string
  }) => Effect.Effect<AuthResult>
  /** Guarded single-step account operation with server-code passthrough. */
  readonly runAccountCommand: (
    key: string,
    input: unknown,
  ) => Effect.Effect<CommandResult>
}

export const AuthFlows = Context.Service<AuthFlows>('AuthFlows')

const GENERIC: AuthResult = { ok: false, code: 'generic' }

function isInviteRequired(error?: SdkError | null): boolean {
  return (
    error?.code === 'SIGNUP_INVITE_REQUIRED' ||
    error?.message?.includes('invite-only') === true
  )
}

function isPasskeyCancel(error?: SdkError | null): boolean {
  return typeof error?.code === 'string' && /cancel/i.test(error.code)
}

export function makeAuthFlows(deps: AuthFlowDeps): AuthFlows {
  const checkPassword = deps.isStrongPassword ?? isStrongPassword
  const markEligible = deps.markEligible ?? (() => undefined)

  const inflightRef = Effect.runSync(
    Ref.make(new Map<string, Deferred.Deferred<AuthResult>>()),
  )

  /** Single-flight gate: concurrent identical submits share one execution. */
  const guarded = (
    key: string,
    run: Effect.Effect<AuthResult>,
  ): Effect.Effect<AuthResult> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const existing = (yield* Ref.get(inflightRef)).get(key)
        if (existing) return yield* restore(Deferred.await(existing))
        const gate = yield* Deferred.make<AuthResult>()
        yield* Ref.update(inflightRef, (current) =>
          new Map(current).set(key, gate),
        )
        // Flows report outcomes as data and never fail typed; the exit is
        // still read defensively so joiners always wake.
        const outcome = yield* restore(Effect.exit(run))
        yield* Ref.update(inflightRef, (current) => {
          const next = new Map(current)
          next.delete(key)
          return next
        })
        if (Exit.isSuccess(outcome)) {
          yield* Deferred.succeed(gate, outcome.value)
          return outcome.value
        }
        yield* Deferred.succeed(gate, GENERIC)
        return GENERIC
      }),
    )

  const sdk = <T>(
    call: (signal: AbortSignal) => Promise<T>,
  ): Effect.Effect<T, unknown> =>
    Effect.tryPromise({ try: call, catch: (error: unknown) => error })

  const postAuth = (routes: {
    readonly redirectTo: string
    readonly completeProfilePath: string
  }): Effect.Effect<AuthResult> =>
    Effect.gen(function* () {
      // Genuine success in this tab: the only path that marks eligibility.
      yield* Effect.sync(markEligible)
      // Best-effort freshness: verification failure preserves offline
      // identity and still routes (parity with the panel flows).
      yield* Effect.ignore(
        Effect.tryPromise({
          try: (signal) => deps.verifySession?.(signal) ?? Promise.resolve(),
          catch: (error: unknown) => error,
        }),
      )
      const account = yield* Effect.matchEffect(
        Effect.tryPromise({
          try: (signal) => deps.getAccount?.(signal) ?? Promise.resolve(null),
          catch: (error: unknown) => error,
        }),
        {
          onFailure: () => Effect.succeed(null),
          onSuccess: (value) => Effect.succeed(value),
        },
      )
      const href =
        account && account.needsProfile
          ? routes.completeProfilePath
          : routes.redirectTo
      yield* Effect.tryPromise({
        try: () => deps.navigate?.(href) ?? Promise.resolve(),
        catch: (error: unknown) => error,
      }).pipe(Effect.ignore)
      return { ok: true as const, next: 'continue' as const }
    })

  const signInWithPassword: AuthFlows['signInWithPassword'] = (
    credentials,
    routes,
  ) =>
    guarded(
      'password:sign-in',
      Effect.gen(function* () {
        if (!deps.signInEmail) return GENERIC
        const email = credentials.email.trim()
        const result = yield* sdk((signal) =>
          deps.signInEmail!({ email, password: credentials.password }, signal),
        ).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.succeed({ error: { code: 'REQUEST_FAILED' } }),
            onSuccess: (value) => Effect.succeed(value),
          }),
        )
        if (result.error) {
          return { ok: false as const, code: 'invalidCredentials' as const }
        }
        return yield* postAuth(routes)
      }),
    )

  const signUpWithPassword: AuthFlows['signUpWithPassword'] = (credentials) =>
    guarded(
      'password:sign-up',
      Effect.gen(function* () {
        if (!deps.signUpEmail) return GENERIC
        if (!checkPassword(credentials.password)) {
          return { ok: false as const, code: 'passwordPolicy' as const }
        }
        if (
          credentials.confirmPassword !== undefined &&
          credentials.password !== credentials.confirmPassword
        ) {
          return { ok: false as const, code: 'passwordMismatch' as const }
        }
        const email = credentials.email.trim()
        const result = yield* sdk((signal) =>
          deps.signUpEmail!(
            {
              email,
              password: credentials.password,
              callbackURL: credentials.callbackURL,
            },
            signal,
          ),
        ).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.succeed({ error: { code: 'REQUEST_FAILED' } }),
            onSuccess: (value) => Effect.succeed(value),
          }),
        )
        if (result.error) {
          if (isInviteRequired(result.error)) {
            return { ok: false as const, code: 'signupInviteRequired' as const }
          }
          if ((result.error as SdkError).message?.includes('already')) {
            return { ok: false as const, code: 'invalidCredentials' as const }
          }
          return { ok: false as const, code: 'generic' as const }
        }
        yield* Effect.sync(markEligible)
        return { ok: true as const, next: 'verify' as const }
      }),
    )

  const signInWithMagicLink: AuthFlows['signInWithMagicLink'] = (input) =>
    guarded(
      'email:magic-link',
      Effect.gen(function* () {
        if (!deps.sendMagicLink) return GENERIC
        if (!input.email.trim()) {
          return { ok: false as const, code: 'emailRequired' as const }
        }
        const result = yield* sdk((signal) =>
          deps.sendMagicLink!(
            {
              email: input.email.trim(),
              callbackURL: input.callbackURL,
              newUserCallbackURL: input.newUserCallbackURL,
            },
            signal,
          ),
        ).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.succeed({ error: { code: 'REQUEST_FAILED' } }),
            onSuccess: (value) => Effect.succeed(value),
          }),
        )
        if (result.error) {
          if (isInviteRequired(result.error)) {
            return { ok: false as const, code: 'signupInviteRequired' as const }
          }
          return { ok: false as const, code: 'magicLinkFailed' as const }
        }
        yield* Effect.sync(markEligible)
        return { ok: true as const, next: 'verify' as const }
      }),
    )

  const signInWithPasskey: AuthFlows['signInWithPasskey'] = (routes) =>
    guarded(
      'passkey:sign-in',
      Effect.gen(function* () {
        if (!deps.signInPasskey) return GENERIC
        // Activation boundary: the component invokes the SDK from the
        // gesture; the service only sequences the outcome. No async
        // scheduling runs before invocation inside the SDK call itself.
        const result = yield* sdk((signal) => deps.signInPasskey!(signal)).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.succeed({ error: { code: 'REQUEST_FAILED' } }),
            onSuccess: (value) => Effect.succeed(value),
          }),
        )
        if (result.error) {
          // Closing the browser prompt surfaces as an error too: report it
          // as a cancellation so callers stay silent instead of alarming.
          if (isPasskeyCancel(result.error)) {
            return { ok: false as const, code: 'passkeyCancelled' as const }
          }
          return { ok: false as const, code: 'passkeyFailed' as const }
        }
        return yield* postAuth(routes)
      }),
    )

  const signInWithSocial: AuthFlows['signInWithSocial'] = (input) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (!deps.signInSocial) return
        const existing = (yield* Ref.get(inflightRef)).get('social')
        if (existing) {
          // A redirect is already leaving: join it (navigation tears us
          // down) instead of opening a second round-trip.
          return yield* restore(Deferred.await(existing))
        }
        const gate = yield* Deferred.make<AuthResult>()
        yield* Ref.update(inflightRef, (current) =>
          new Map(current).set('social', gate),
        )
        // Eligibility is marked BEFORE the redirect leaves (parity): the
        // landing tab inherits it across the round-trip.
        yield* Effect.sync(markEligible)
        yield* restore(
          Effect.ignore(
            Effect.tryPromise({
              try: (signal) =>
                deps.signInSocial!(
                  { provider: input.provider, callbackURL: input.callbackURL },
                  signal,
                ),
              catch: (error: unknown) => error,
            }),
          ),
        )
      }),
    )

  const signInAnonymous: AuthFlows['signInAnonymous'] = (routes) =>
    guarded(
      'anonymous:sign-in',
      Effect.gen(function* () {
        if (!deps.signInAnonymous) return GENERIC
        const result = yield* sdk((signal) =>
          deps.signInAnonymous!(signal),
        ).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.succeed({ error: { code: 'REQUEST_FAILED' } }),
            onSuccess: (value) => Effect.succeed(value),
          }),
        )
        if (result.error) return GENERIC
        return yield* postAuth(routes)
      }),
    )

  const runAccountCommand: AuthFlows['runAccountCommand'] = (key, input) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (!deps.runCommand) {
          return { ok: false as const, code: 'COMMAND_UNAVAILABLE' }
        }
        const outcome = yield* restore(
          Effect.exit(
            Effect.tryPromise({
              try: (signal) => deps.runCommand!(key, input, signal),
              catch: (error: unknown) => error,
            }),
          ),
        )
        if (Exit.isSuccess(outcome)) return { ok: true as const }
        const found = Cause.findErrorOption<unknown>(outcome.cause)
        const error = Option.isSome(found) ? found.value : null
        const rawCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined
        const code =
          typeof rawCode === 'string' && rawCode.length > 0
            ? rawCode
            : 'COMMAND_FAILED'
        return { ok: false as const, code }
      }),
    )

  return {
    signInWithPassword,
    signUpWithPassword,
    signInWithMagicLink,
    signInWithPasskey,
    signInWithSocial,
    signInAnonymous,
    runAccountCommand,
  }
}

export function makeAuthFlowsLive(deps: AuthFlowDeps): Layer.Layer<AuthFlows> {
  return Layer.succeed(AuthFlows, makeAuthFlows(deps))
}
