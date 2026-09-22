/**
 * Session freshness policy (single source of truth).
 *
 * Better-auth's `freshSessionMiddleware` rejects sessions older than `freshAge`
 * with `SESSION_NOT_FRESH` on passkey enrollment (`generate-register-options`,
 * `verify-registration`), OAuth unlink, and session listing. Freshness is
 * measured against `session.createdAt`, which never slides on refresh — so with
 * our 180-day rolling sessions any finite window eventually expires for
 * long-lived logins and the client must offer a re-authentication roundtrip
 * (see `passkeyFreshAgeSeconds` in `features.get` and the web passkey
 * settings).
 *
 * Thirty days keeps the anti-persistence bound meaningful (a stolen old cookie
 * alone cannot bind a new long-lived credential) while keeping the re-auth
 * modal rare. `0` would disable the check entirely (the client treats it as
 * always-fresh; keep the features schema `.nonnegative()`).
 *
 * Web mirror: `passkeyFreshAgeSeconds` in `useDeploymentConfig`
 * (apps/web/src/lib/deployment-config.ts) — update both together.
 */
export const SESSION_FRESH_AGE_SECONDS = 30 * 24 * 60 * 60
