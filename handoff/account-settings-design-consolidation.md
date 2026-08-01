# Account Settings Design Consolidation — Implementation Handoff

Status: design direction chosen; implementation not started.

## Outcome

Consolidate `/account/settings` around a quiet, mobile-first **inset settings
list** pattern. Keep Spliit's existing card surfaces, typography, controls,
green accent, and responsive behavior. The page should feel like one system:
consistent section headers on the outside and consistent label / description /
control rows on the inside.

This is a visual and usability refactor. Do not change preference storage,
feature gating, notification rules, upload behavior, or save semantics.

## Why this direction fits Spliit

The app already uses restrained `Card` surfaces, compact Lucide icons, divided
lists, and `mobile-surface` to flatten cards on small screens. The notification
list is the strongest starting point because settings are easier to scan as
rows than as a stack of unrelated mini-cards. Use that structure across the
page, but make it a shared local pattern rather than copying notification
classes into every component.

Do not introduce a new font, decorative gradients, large illustrations,
elevated icon tiles, or a new color palette. This page is utility UI; clarity,
alignment, and predictable control placement should carry the design.

## Current inconsistencies

| Area                | Current treatment                                                                              | Consolidation target                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Profile             | Plain card plus a dashed, green-tinted photo panel and explicit form footer                    | Standard section header and settings rows; only the Save button is visually primary                             |
| App preferences     | Unframed vertical field stack; autosave spinner lives in the title                             | Standard settings rows with a consistent autosave status in the section header                                  |
| AI features         | Every item is its own bordered mini-card; dashed placeholder cards; primary-colored title icon | Divided settings rows; neutral title icon; compact coming-soon rows without fake disabled controls              |
| Notifications       | Grouped divided lists, plus a separately styled device block                                   | Use as the baseline; align its rows, selectors, subsection spacing, and device controls with the shared pattern |
| Section headers     | Some have icons, some do not; icon size and color vary                                         | Every section uses the same title anatomy and a muted 16px icon                                                 |
| Responsive controls | Some controls stay narrow while others stack or fill the row                                   | Full-width controls on mobile; aligned, bounded control column from `sm` upward                                 |

## Target page anatomy

Keep the existing page width, page title, back behavior, section order, and
`gap-6` rhythm:

1. Profile — identity and account fields, explicit Save.
2. App preferences — currency, timezone, language, and theme, autosaved.
3. AI features — enabled capabilities and compact future-feature notices,
   autosaved and still deployment-gated.
4. Notifications — category delivery preferences and this-device push state,
   autosaved per row.

Each section should have:

- one `mobile-surface` outer surface;
- a header with a muted `size-4` icon, an `h2`-level title at `text-lg`, and the
  existing description;
- an optional trailing status area for a spinner / short screen-reader status;
- content composed from one shared divided-row treatment;
- no bespoke background or border treatment unless it communicates a real
  warning or error.

Suggested header icons are `UserRound`, `SlidersHorizontal`, `Sparkles`, and
`Bell`. Give all four the same muted color; AI should not receive a unique
primary accent.

## Shared local building blocks

Add a small account-settings-only presentation module, for example
`apps/web/src/app/account/settings-ui.tsx`. Do not broaden the global `Card`
primitive for a pattern only used on this page.

The module should provide composable pieces rather than own any data:

- `SettingsSection`: outer `Card`, consistent header, semantic `h2`, icon,
  description, optional `id`, optional status, and content spacing.
- `SettingsList`: one `overflow-hidden rounded-lg border` group with dividers.
- `SettingsRow`: label and optional description on the left; control, badge, or
  actions on the right. Stack vertically on narrow screens and use a stable
  control column at `sm` and above.
- If useful, `SettingsBadge` for the neutral `Coming soon` state. Prefer an
  existing badge primitive if the repo already has an appropriate neutral
  variant.

Keep these pieces flexible enough for field controls, switches, selectors, and
buttons. Avoid conditionals for specific preference keys inside the shared UI.
Use `cn` for variants rather than duplicated class strings.

Recommended row behavior:

- `min-w-0` on both columns so translations can wrap safely;
- label is associated with its control through `htmlFor` / `id`;
- description is `text-sm text-muted-foreground` everywhere (do not alternate
  between `text-xs` and `text-sm` for equivalent help text);
- controls are `w-full` on mobile and have a consistent desktop max width;
- switches and short badges remain intrinsic width and align to the top when a
  description wraps;
- use comfortable row padding consistently (`p-3` mobile, `px-4 py-3` from
  `sm` is a suitable match for the existing notification rows).

## Component work

### 1. Page and profile

File: `apps/web/src/app/account/settings.tsx`

- Replace the profile card markup with `SettingsSection` and `SettingsList`.
- Turn photo, display name, and email into the same row anatomy used elsewhere.
- Remove the dashed border and `bg-primary/3` photo container. The avatar is
  already the visual anchor and does not need another highlighted surface.
- In the photo row, keep the avatar, help copy, upload input, Choose action, and
  conditional Remove action. Make Choose `outline` (or equivalent neutral
  emphasis) so it does not compete with Save.
- Keep the email read-only behavior and its explanatory copy.
- Keep validation and error handling exactly as they are. Show a form-level
  error immediately above the footer, with `role="alert"`.
- Keep one explicit profile Save button in a quiet footer below the rows. It is
  the sole primary call to action in this section and retains the current dirty
  and pending rules.

### 2. App preferences

File: `apps/web/src/app/account/account-preferences.tsx`

- Convert currency, timezone, language, and theme to `SettingsRow` instances.
- Give selectors a shared mobile width and desktop control-column width; do not
  force a switch-sized control and a select-sized control into different row
  grids.
- Preserve immediate persistence and the current optimistic local updates for
  locale and theme.
- Keep the section-level updating spinner, but render it through the shared
  header status slot. It must have accessible status text, not only an
  `aria-hidden` spinner. Reuse existing copy if available; if new copy is
  necessary, add it with `bun i18n` rather than editing message JSON files.
- Replace the blank centered-spinner card with a section-shaped skeleton or
  loading rows so the page does not jump between unrelated layouts.

### 3. AI preferences

File: `apps/web/src/app/account/ai-preferences.tsx`

- Replace `SwitchRow`, `VoiceLanguagePlaceholder`, and
  `CustomInstructionsPlaceholder` shells with the shared rows.
- Preserve deployment gating and the default-on interpretation of missing
  preference values.
- Use a shared header autosave status just like App preferences because both
  use the same account preference updater.
- For future features, show the label, description, and one neutral `Coming
soon` badge in the action column. Remove the fake disabled language select
  and segmented radio controls: they imply configurability, add visual noise,
  and create focus / accessibility complexity without performing an action.
- After removing those fake controls, delete the now-unused local state,
  `InstructionLevel`, segmented-control helpers, locale-option imports, and
  related test expectations.
- When no AI capability is available, continue to render nothing. While the
  deployment feature query is loading, use the common section loading shell;
  do not show a structurally unrelated centered-spinner card.

### 4. Notifications

File: `apps/web/src/app/account/notifications-preferences.tsx`

- Move the outer card/header and row shells to the shared components without
  changing channel selection, push enrollment, optimistic rollback, warnings,
  or query states.
- Retain the three notification subsections. Use the same subsection heading
  size and spacing for each, and use `SettingsList` for their rows.
- Make `ChannelSelector` fill the available width on mobile while retaining a
  compact aligned width on desktop. Preserve Popover on desktop and Drawer on
  mobile.
- Render coming-soon notification rows with the same badge treatment as AI
  rows; do not show the words twice in the same row.
- Convert the “this device” area into a standard settings row or a small final
  subsection using the same list treatment. Alerts remain visually distinct
  because they communicate state, not because the section has a separate
  design language.
- Make error and loading states use the same section header and content frame
  as the successful state.

## Interaction and accessibility requirements

- Preserve the page's single `h1`; section titles must be `h2`, and
  notification group titles should be `h3`.
- Preserve every current label/control association, keyboard path, focus ring,
  toast, `aria-live`, and `role="alert"` behavior.
- Do not make an entire row clickable when it contains selects, buttons, or
  links. Only the associated label may expand the click target for a switch.
- Disabled and pending controls must remain visibly and programmatically
  disabled. A pending mutation should not cause layout shift.
- Long translations must wrap rather than truncate section titles or row
  labels. Verify at least one verbose locale and RTL direction.
- At narrow widths, actions and selects must not force horizontal scrolling.
  Maintain at least 44px touch targets for interactive controls.
- Respect light and dark theme tokens. Do not hard-code neutral colors; keep
  amber / destructive colors only for their existing warning and error states.

## Tests to update or add

Keep behavior-focused tests and avoid assertions against long Tailwind class
lists.

- `account-preferences.test.tsx`: retain immediate persistence tests; add an
  accessible autosave-status assertion if status text is introduced.
- `ai-preferences.test.tsx`: retain feature gating, toggling, and opted-out
  tests; replace disabled-select / segmented-radio tests with assertions that
  future rows expose one `Coming soon` status and no interactive control.
- `notifications-preferences.test.tsx`: retain enrollment, save, rollback, and
  warning tests; update the existing duplicate `Coming soon` expectation for a
  single badge per future row.
- Add focused tests for `settings-ui.tsx` only if it contains behavior or
  semantic branching. Pure class-composition helpers do not need snapshots.
- Add or extend a page-level test to assert one `h1`, correctly ordered `h2`
  section headings, and the profile Save button's dirty-state behavior.

## Visual acceptance checklist

Review `/account/settings` at approximately 375px, 768px, and 1280px in both
light and dark themes.

- All section headers share title size, icon size/color, description spacing,
  and horizontal alignment.
- All preference rows share padding, dividers, label typography, description
  typography, and control alignment.
- The profile image area no longer looks like a special promotional card.
- AI rows no longer look like separate cards nested inside a card.
- Coming-soon rows look informative, not broken or actionable.
- Notification selectors do not overflow and their drawers still work on
  mobile.
- The primary green is reserved for active controls, focus, and the profile
  Save action.
- Loading, saving, error, warning, disabled, and no-AI-feature states all remain
  legible without changing page width or causing large layout jumps.

## Verification commands

Use Bun and do not start the dev server or API as part of this work.

```sh
bun --cwd apps/web test src/app/account/account-preferences.test.tsx src/app/account/ai-preferences.test.tsx src/app/account/notifications-preferences.test.tsx
bun --cwd apps/web check-types
bun --cwd apps/web lint
```

For manual visual review, use an already-running web/API environment. Per repo
rules, do not start the API for integration testing; ask the user if the API on
`:3001` is unavailable.

## Scope boundaries and working-tree caution

- Do not change API, database, domain preference types, notification metadata,
  feature flags, or synchronization behavior for this design pass.
- Do not alter the global `Card`, `Label`, `Select`, `Switch`, or `Button`
  primitives unless a concrete app-wide defect is discovered.
- Do not add settings navigation, tabs, accordions, or a desktop sidebar in
  this pass. The current page length and four-section hierarchy do not justify
  another navigation layer.
- Do not edit `apps/web/src/messages/*` by hand. Use `bun i18n` if copy must
  change.
- The account/AI preference work is currently part of a dirty working tree,
  including untracked AI preference files. Treat those changes as user-owned;
  inspect the current diff before editing and do not overwrite or revert it.

## Definition of done

The four account-settings sections read as one visual system on mobile and
desktop; their business behavior is unchanged; false affordances for unshipped
AI controls are gone; semantic heading order and responsive control alignment
are improved; focused tests, type-checking, and lint pass; and unrelated dirty
worktree changes remain untouched.
