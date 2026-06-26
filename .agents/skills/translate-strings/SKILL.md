---
name: translate-strings
description: Use when translating missing strings into a non-English locale for the Spliit web app. Loads the list of keys needing translation, applies translations via the `bun i18n` CLI, and never touches en-US.json.
license: MIT
---

# Translate missing strings

You translate missing keys in a single non-English locale. You never edit `en-US.json` — the source of truth is owned by code-change agents.

## Input

A target locale (e.g. `fr-FR`, `es`, `de-DE`, `ja-JP`). Optionally a list of specific keys to focus on; otherwise translate every key missing in the locale.

## Workflow

1. **Enumerate** the missing keys for the target locale:

   ```bash
   bun i18n missing --locale <locale> --json
   ```

   For PR-scoped work, also run `bun i18n diff --json --locale <locale>` to see only the keys introduced by the current git change (vs the legacy backlog).

2. **Read** the English value for each key:

   ```bash
   bun i18n get en-US <key>
   ```

3. **Look up the usage context in the codebase.** The English value and the key name often do not fully convey the meaning — a string like "Owner" or "Title" can mean very different things depending on where it appears. Find every place the key is consumed before translating:

   ```bash
   rg -n --no-heading "t\(['\"]<key>['\"]\)" apps/web/src
   rg -n --no-heading "['\"]<key>['\"]" apps/web/src
   ```

   For key prefixes (e.g. `Members.leave.body.lastAdmin.title`), also search the prefix to see the section it belongs to:

   ```bash
   rg -n --no-heading "Members\.leave" apps/web/src
   ```

   Read the surrounding component to understand:
   - Who sees the string (admin vs regular member? error toast vs page header?)
   - What action triggers it (button? label? confirmation?)
   - Whether it includes dynamic values (the i18next `{placeholder}` syntax)
   - Cultural conventions of the form (e.g. "Cancel" vs "No, keep it")

4. **Read 2-3 nearby translations** in the target locale to match tone, formality, and style:

   ```bash
   bun i18n get <locale> <nearby.key>
   ```

   Use `bun i18n list <locale>` if you need to browse.

5. **Translate** the value. Preserve verbatim:
   - i18next placeholders: `{name}`, `{count}`, `{paidBy}`, etc.
   - HTML/XML tags: `<strong>`, `<paidFor></paidFor>`, `<source>...</source>`
   - Whitespace, punctuation, and surrounding context
   - Capitalization style of the locale (e.g. English Title Case vs French sentence case)

6. **Apply** the translation:

   ```bash
   bun i18n set <locale> <key> "<translation>"
   ```

   The CLI inserts the new key in the same relative position as in `en-US.json` automatically (existing keys are not reordered). You do not need to manage file order.

7. **Verify** the keys you translated are no longer missing:

   ```bash
   bun i18n missing --locale <locale> --json
   ```

8. **Sanity-check** structure with `bun i18n validate`.

## Hard rules

- **NEVER** edit `apps/web/src/messages/en-US.json`. The source of truth is owned by code-change agents.
- **NEVER** add a key that does not exist in en-US. If you think a key should exist, stop and report it.
- **NEVER** remove keys from any locale. Removal is the code-change agent's job (`bun i18n remove`).
- **ALWAYS** look up the usage context (step 3) before translating. A literal translation of a string is often wrong because the meaning depends on the surrounding UI.
- If a value cannot be translated meaningfully (brand name, product name, code identifier), keep the English value and note it in the final report.
- Do not run `bun i18n add` — that touches en-US. Use `bun i18n set <locale> <key> "..."` for every change you make.

## Output

When done, report:

- Target locale translated
- Number of keys translated
- Any keys you skipped (with reason: brand name, ambiguous, etc.)
- Any keys you noticed are missing from en-US (so a human can decide whether to add them)
- Any keys where the English value felt ambiguous and you had to infer from context (so a human can clarify the source string if needed)

## Reference

- `bun i18n help` — full CLI reference
- `bun i18n list <locale>` — list all keys in a locale (flat dotted paths)
- `bun i18n get <locale> <key>` — read a single value
- `bun i18n set <locale> <key> "<value>"` — write a single value
- `bun i18n missing --locale <locale> [--json]` — audit missing keys
- `bun i18n diff [--locale <locale>] [--json]` — git-scoped change view
