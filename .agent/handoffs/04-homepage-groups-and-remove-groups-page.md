# Handoff: Homepage Groups and Remove Groups Page

## Goal

Remove the separate groups page and show the user's groups directly on the signed-in landing page.

## Decisions

- `/` is the signed-in group dashboard.
- Keep the current landing tagline and make the groups list play naturally beneath/alongside it.
- Remove `/groups` as a first-class page.
- Update all in-app links and redirects so no public/stale URLs are emitted.
- Do not keep stale URLs intentionally. If a compatibility redirect is added during implementation, it should be treated as temporary and removed before the feature is considered done.

## Recommended UX

- Signed out:
  - keep current landing/sign-in layout.
- Signed in:
  - keep current tagline,
  - render pending invitations and group list on `/`,
  - provide a clear create-group action,
  - preserve starred, active, archived, and hidden group behavior.
  - consider greeting the user by their display name (e.g. "Welcome back, {name}.") above or alongside the tagline — a small, human touch that signals the page is theirs. The name is already on the account, so this comes for free once the new signed-in landing exists.

## Task Breakdown

- Extract `RecentGroupList` into a reusable component that does not assume it owns the whole `/groups` page heading.
- Render the reusable group list in `apps/web/src/app/page.tsx` when signed in.
- Remove or disable `apps/web/src/routes/groups/index.*`.
- Update links from `/groups` to `/` where they mean "my groups":
  - app header,
  - group header back link,
  - unauthorized fallback,
  - create/edit cancel links,
  - post-sign-in/profile-completion redirects.
- Keep group detail routes under `/groups/$groupId/...` unless a separate URL migration is explicitly planned.
- Update tests that navigate to `/groups` for the group list.
- Update i18n labels if "Groups" nav becomes "Home" or is removed.
- Run `rg 'href=\"/groups\"|to=\"/groups\"|/groups\\?' apps/web/src apps/web/tests` and remove stale list-page references.
- Run `bun check-types`.
- Run targeted Playwright tests for home, group navigation, invitations, archive/hide/star controls, and create group.

## Code References

- Current signed-in homepage CTA: `apps/web/src/app/page.tsx`
- Current groups list: `apps/web/src/app/groups/recent-group-list.tsx`
- Current `/groups` route files: `apps/web/src/routes/groups/index.tsx`, `apps/web/src/routes/groups/index.lazy.tsx`
- App header groups link: `apps/web/src/AppShell.tsx`
