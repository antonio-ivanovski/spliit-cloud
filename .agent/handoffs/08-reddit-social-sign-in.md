# Handoff: Reddit Social Sign-In

## Goal

Add Reddit OAuth sign-in/sign-up through Better Auth, with explicit handling for Reddit's lack of real email support. For providers that do not provide email, Spliit uses synthetic email addresses so the current Better Auth/account schema can keep `Account.email` required.

## Key Constraint

Reddit OAuth identity data does not provide the actual email address through the normal profile response. It can expose whether the Reddit account has a verified email, but not the email value itself.

That means Reddit sign-in cannot populate `Account.email` with a real deliverable address the way Google does or the way the current GitHub implementation does after fetching verified emails. It should instead populate a deterministic synthetic email and keep `emailVerified = false`.

## Product Decision

Use synthetic email addresses for social providers that do not return a real email.

Recommended format:

- `reddit:${redditUserId}@synthetic.spliit.local` is not a valid email shape for many validators because of `:`.
- Prefer a valid, clearly internal format such as `reddit-${redditUserId}@synthetic.spliit.local`.
- Use the provider's stable id, not username, because Reddit usernames can be renamed or displayed differently.

Guardrails:

- Synthetic emails are identity placeholders only.
- They are not deliverable contact addresses.
- They must not be marked verified.
- They must not be used for outbound mail, notifications, magic links, password reset, or email invitation matching.
- Account settings should label them as no email on file rather than showing them as a normal address.

## Current State

- `Account.email` is required and unique in `packages/db/prisma/schema.prisma`, so synthetic email keeps the schema compatible.
- Email/password, magic link, password reset, email verification, notifications, and email invites assume a real email address.
- GitHub currently has custom logic to require a verified email.
- Better Auth account linking relies on trusted providers and verified email matching for existing email-backed accounts.

## Recommended Approach

Preferred sequence:

1. Implement invitation model refactor if link invites and synthetic-email accounts are part of the roadmap.
2. Add synthetic-email handling for no-email social providers.
3. Add Reddit provider with custom profile mapping.
4. Add UI affordances for "no real email on file" and optional add/verify email later.

For a conservative first release:

- Add Reddit OAuth.
- Create the account with a deterministic synthetic email and `emailVerified = false`.
- Do not allow the account to accept email invitations, receive notifications, use password reset, or use magic-link flows until a real email is added and verified.
- Link-invite acceptance should work because it does not require a real email.

## Data Model Considerations

No nullable-email schema change is required for the first Reddit implementation if synthetic emails are used.

Still audit code that assumes `Account.email` is deliverable:

- email sending,
- magic-link sign-in,
- password reset,
- invitation email matching,
- UI display of account email,
- exports or member lists that show email.

Preferred future structure:

- Add a first-class `realEmail`/contact email concept or an `AccountEmail` table.
- Keep synthetic `Account.email` as the Better Auth compatibility identifier until the auth model can be changed more deeply.
- When a real email is added and verified, decide whether to migrate `Account.email` to the real email or keep synthetic email and store contact emails separately.

## Better Auth Provider Work

Add environment config:

- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- optional web flag such as `VITE_ENABLE_REDDIT_OAUTH`

Update API auth config:

- Add `reddit: 'Reddit'` to auth method labels.
- Add provider config under `socialProviders`.
- Add `reddit` to `account.accountLinking.trustedProviders` only if account linking behavior is correct for no-email accounts.

Important:

- Use custom `getUserInfo` if Better Auth's built-in Reddit mapping does not provide a usable email.
- Return a synthetic email in the Better Auth user payload.
- Set `emailVerified: false`.
- Preserve Reddit's provider account id in `AuthIdentity.accountId`.
- Do not include `reddit` in trusted providers for email-based account linking unless the implementation prevents synthetic email collisions and avoids linking by unverified synthetic email.

## Web UX

Update `apps/web/src/components/auth/auth-panel.tsx`:

- Add a Reddit button when enabled.
- Use copy like `Continue with Reddit`.
- After Reddit callback:
  - if the account only has a synthetic email, continue to display-name completion if needed,
  - show an optional add-email prompt in account settings or onboarding, not as a blocker unless notifications/recovery are required.

Account/settings surfaces:

- Synthetic email should render as "No email added" or equivalent, not as the internal synthetic address.
- Provide an "Add email" action if that flow is implemented.

## Invite Compatibility

Email invitations:

- Reddit accounts with only synthetic email cannot accept email-targeted invites.
- They can accept email-targeted invites only after adding and verifying the matching real email.

Single-use link invitations:

- Reddit accounts can accept link invites with only a synthetic email if the link-invite handoff is implemented.

Pending group read access:

- Email-based pending access must ignore synthetic emails.
- Token-based invite preview/accept should be the path for users without a real verified email.

## Tests

Add tests for the selected behavior:

- Reddit provider appears in auth config when env vars are present.
- Reddit provider is absent when env vars are missing.
- Reddit sign-in creates deterministic synthetic email from Reddit user id.
- Synthetic email is unique, stable, and marked `emailVerified = false`.
- UI does not display synthetic email as a normal contact email.
- Email sending skips or rejects synthetic emails.
- Email invite acceptance rejects synthetic email.
- Link invite acceptance works for Reddit account with synthetic email if link invites are implemented.

## Verification

Run:

```bash
bun check-types
bun run test
```

If schema changes are included:

```bash
bun prisma-generate
```

Manually verify with a configured Reddit OAuth app before shipping.

## Code References

- API auth config: `apps/api/src/lib/auth/index.ts`
- API env schema: `apps/api/src/lib/env.ts`
- Account model: `packages/db/prisma/schema.prisma`
- Auth session refresh: `apps/api/src/lib/auth/session.ts`
- Web auth panel: `apps/web/src/components/auth/auth-panel.tsx`
- Account settings: `apps/web/src/app/account/settings.tsx`
- Require-auth/profile completion: `apps/web/src/components/require-auth.tsx`, `apps/web/src/app/auth/complete-profile.tsx`
- Invitation logic: `apps/api/src/lib/invitations.ts`
- Invitation refactor handoff: `.agent/handoffs/06-invitation-model-refactor.md`
- Link invite handoff: `.agent/handoffs/07-single-use-link-invitations.md`
