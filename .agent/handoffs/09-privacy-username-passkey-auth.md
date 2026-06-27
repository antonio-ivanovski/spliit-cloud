# Handoff: Privacy-Focused Username Auth and Passkeys

## Goal

Design and implement a privacy-focused auth option where users can create and use an account without providing a real email address. The target UX should support username plus password and, preferably, username plus passkey. Because the current Better Auth/account schema requires `Account.email`, username-only accounts should use synthetic emails internally while treating real email as optional contact/recovery metadata.

## Better Auth Constraints

Better Auth's username plugin adds username support to the email/password authenticator. It lets users sign in with `authClient.signIn.username({ username, password })`, but username sign-up still uses the existing `signUp.email` flow and expects email/name/password plus optional `username` fields.

Better Auth's passkey plugin supports:

- authenticated users adding a passkey with `authClient.passkey.addPasskey(...)`,
- passkey sign-in with `authClient.signIn.passkey({ autoFill: true })`,
- passkey-first registration when `passkey({ registration: { requireSession: false, resolveUser } })` is configured.

This means true real-email-less username/passkey accounts need deliberate server-side design. Do not assume the username plugin alone removes the email requirement.

Docs:

- https://better-auth.com/docs/plugins/username
- https://better-auth.com/docs/plugins/passkey

## Product Direction

Preferred privacy-first account model:

- Required account handle: username.
- Required display name: can default to username, editable later.
- Required authentication method:
  - passkey, preferred, or
  - password, fallback.
- Optional real email:
  - used only for notifications, recovery, magic-link sign-in, and email invite matching,
  - can be added and verified later.

Use synthetic emails for username-only users to satisfy the current required unique `Account.email` column. Synthetic emails are internal identity placeholders, not deliverable email addresses.

## Non-Goals

- Do not remove existing email/password, magic-link, Google, or GitHub sign-in.
- Do not force existing accounts to pick usernames immediately unless needed by schema constraints.
- Do not make email invitations work for accounts that only have synthetic emails; that belongs to the invite refactor/link-invite handoffs.
- Do not expose usernames as irreversible public IDs until product/privacy implications are settled.

## Prerequisite Architecture Decision

Choose one implementation path:

### Path A: Incremental Username + Password With Email Still Required

Use Better Auth's username plugin as designed:

- Add username fields.
- Keep email required.
- Allow users to sign in with username/password instead of email/password.

This is lower risk but does not satisfy true email-less privacy goals.

### Path B: Real-Email-Less Accounts With Synthetic Email

Keep the current required `Account.email` shape initially, but generate synthetic email values for username-only accounts:

- Add deterministic synthetic email generation.
- Add `username` and likely `displayUsername`.
- Add uniqueness on normalized username.
- Audit all `ctx.auth.user.email` usages so synthetic emails are not treated as real contact addresses.
- Gate email-only features behind verified email.
- Use passkey-first registration or a custom username/password creation path compatible with Better Auth.

This is the path that matches the requested privacy-focused direction.

## Recommended Data Model

If implementing real-email-less accounts with synthetic email:

- Keep `Account.email String @unique` for Better Auth compatibility.
- Generate synthetic email in a valid internal domain, e.g. `username-${accountId}@synthetic.spliit.local` or `user-${stableId}@synthetic.spliit.local`.
- `Account.emailVerified Boolean @default(false)`
- `Account.username String? @unique`
- `Account.displayUsername String?`
- Keep `Account.name String`, but decide whether it mirrors display name or remains profile display name.

Synthetic email rules:

- Use a stable non-guess-critical id, not the username if usernames can change.
- Mark `emailVerified = false`.
- Never send email to synthetic domains.
- Never show synthetic emails as real account emails in the UI.
- Never use synthetic emails for email invitation matching.
- If a real email is later added and verified, decide whether to replace `Account.email` or store real contact email separately.

Passkey plugin schema:

- Add the Better Auth passkey table to Prisma manually or via generated schema review.
- Ensure the table uses the local model naming conventions and references the Spliit `Account` model correctly.

Migration notes:

- Existing accounts may have `username = null`.
- New username-auth accounts require username.
- Nullable email is not required if the synthetic-email approach is used.

## API/Auth Implementation

Server:

- Add `username()` plugin from `better-auth/plugins` if using username/password.
- Add `passkey()` plugin from `@better-auth/passkey`.
- Add passkey client plugin in `apps/web/src/lib/auth.ts`.
- Configure username validation:
  - 3-30 chars, or choose stricter product limits,
  - lowercase normalized username,
  - allow `a-z`, `0-9`, `_`, `.`, maybe `-`,
  - reserve names like `admin`, `support`, `spliit`, `api`, `invite`.
- Keep the existing strong password policy for username/password.

Passkey-first registration:

- Consider `registration.requireSession: false`.
- Use `resolveUser` with an opaque signed registration context created by the server after validating username availability.
- The registration context should include normalized username, display name, creation timestamp, and nonce.
- On verification, create/load the user and attach the passkey.
- Expire the registration context quickly.

Password fallback:

- If Better Auth cannot create real-email-less username/password accounts directly through `signUp.email`, use the synthetic email as the internal email value.
- The synthetic email must remain hidden from the user-facing auth UI.
- Prefer passkey-first for true email-less accounts because Better Auth explicitly supports pre-auth passkey registration via `resolveUser`.

## Sign-In UX

The auth panel should be organized around clear methods, not a long pile of fields.

Recommended first screen:

- Primary field: `Username or email`
  - `autocomplete="username webauthn"` so passkey conditional UI can attach.
- Primary button: `Continue`
- Secondary prominent button: `Use passkey`
- Social buttons remain below or above depending current layout.
- Email magic link/password flows remain available but should not dominate privacy-first sign-in.

After entering identifier:

- If the browser offers a passkey, let WebAuthn conditional UI handle it.
- If the user clicks `Use passkey`, call `authClient.signIn.passkey({ autoFill: true })` or explicit passkey sign-in.
- If username/password is available, show password field:
  - `autocomplete="current-password webauthn"`
  - submit with `authClient.signIn.username({ username, password })` for usernames,
  - existing email/password for email identifiers.

Error UX:

- Use generic invalid credential text.
- Do not reveal whether a username exists on sign-in.
- Username availability checks are allowed only during sign-up.

## Sign-Up UX

Recommended sign-up screen:

- Method choice at top:
  - `Passkey` as recommended/default,
  - `Password` as fallback.
- Username field:
  - inline availability check after debounce,
  - show allowed characters and length only when invalid or focused,
  - normalize quietly but preserve `displayUsername` for presentation if supported.
- Display name field:
  - optional if username can be used as display name,
  - otherwise required with short explanation.
- Email field:
  - optional,
  - label as `Email for notifications and recovery (optional)`,
  - do not block account creation if empty.

Passkey sign-up flow:

1. User enters username and optional display name/email.
2. UI validates username availability.
3. User clicks `Create account with passkey`.
4. Server creates signed registration context including the normalized username and synthetic email seed.
5. Client calls `authClient.passkey.addPasskey({ name, context })`.
6. On success, redirect to app or invite acceptance callback.

Password sign-up flow:

1. User enters username, password, optional display name/email.
2. Password field shows current strength rules.
3. If no real email is provided, server uses synthetic email internally.
4. On success, redirect to app or invite acceptance callback.

## Fill and Autofill UX

Use browser autofill intentionally:

- Username/email field:
  - `autocomplete="username webauthn"`.
- Current password field:
  - `autocomplete="current-password webauthn"`.
- New password field:
  - `autocomplete="new-password"`.
- Optional email field:
  - `autocomplete="email"`.

On mount:

- Check `PublicKeyCredential.isConditionalMediationAvailable`.
- If available, preload passkey sign-in with `authClient.signIn.passkey({ autoFill: true })`.
- Some browsers need the user to focus the identifier field before passkey autofill appears; keep the field first and focused when appropriate.

Do not show explanatory walls of text in the auth panel. Use compact labels, helper text only on focus/error, and clear button hierarchy.

## Account Settings UX

Add account security/profile management:

- Username display and update flow.
- Passkey list:
  - list registered passkeys,
  - show friendly authenticator labels when available,
  - allow rename/delete,
  - prevent deleting the last auth method.
- Add passkey button for password/social accounts.
- Optional email add/change/verify flow.
- Recovery warning if the account has no real email and only one passkey.
- Hide synthetic email values; show `No email added` or equivalent.

## Invite Compatibility

Email invitations:

- Continue requiring a verified matching email.
- Username/passkey users with only synthetic email should be prompted to add/verify email if trying to accept an email invite.

Single-use link invitations:

- Should work with synthetic-email accounts once implemented.
- Preserve callback URL through sign-in/sign-up so accepting an invite by link is smooth.

## Tests

Add tests for:

- username normalization and uniqueness,
- reserved username rejection,
- username availability endpoint behavior,
- username/password sign-in when supported,
- passkey plugin schema/config presence,
- passkey-first registration context validation,
- synthetic email generation is stable and unique,
- synthetic emails are marked unverified,
- account APIs hide synthetic email from user-facing profile data where appropriate,
- email-only flows reject or redirect when only a synthetic email is present,
- auth panel renders username/passkey options without breaking existing email/social flows.

Manual/browser tests:

- Passkey conditional UI appears where supported.
- Sign-up with passkey works in Chrome/Safari.
- Password manager fills username/password correctly.
- Invite callback survives auth redirect.

## Verification

Run:

```bash
bun prisma-generate
bun check-types
bun run test
```

For browser UX:

```bash
bun test-e2e
```

Use Chrome's WebAuthn virtual authenticator tooling for local passkey testing when physical authenticators are unavailable.

## Code References

- API auth config: `apps/api/src/lib/auth/index.ts`
- API env/schema behavior: `apps/api/src/lib/env.ts`
- Account model: `packages/db/prisma/schema.prisma`
- Auth client: `apps/web/src/lib/auth.ts`
- Auth panel: `apps/web/src/components/auth/auth-panel.tsx`
- Require-auth/profile completion: `apps/web/src/components/require-auth.tsx`
- Complete profile page: `apps/web/src/app/auth/complete-profile.tsx`
- Account settings: `apps/web/src/app/account/settings.tsx`
- Invitation refactor handoff: `.agent/handoffs/06-invitation-model-refactor.md`
- Link invite handoff: `.agent/handoffs/07-single-use-link-invitations.md`
- Reddit sign-in handoff: `.agent/handoffs/08-reddit-social-sign-in.md`
