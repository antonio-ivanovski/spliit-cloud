---
name: translate-strings
description: After en-US changes, run bun i18n plan to oneshot or dispatch translator subagents; translators pack/set/check and use bun i18n usages when meaning is ambiguous. Never hand-edits message JSON or pastes English into other locales.
license: MIT
---

# Translate strings

Two roles share this skill: the **main agent** (after editing en-US) and **translator** subagents (filling other locales).

## Hard rules (both roles)

- **Never** paste English into another locale as a placeholder. `set` rejects identical-to-en (unless auto-allowed or `--allow-english` for brands).
- **Never** hand-edit `apps/web/src/messages/*.json`. Use the CLI only.
- **Never** run `bun i18n add` while translating — that writes en-US.
- Translators own only the locales in their batch; do not edit other families’ files or en-US.
- Finish with the scoped `bun i18n check` exit **0**.

## Ambiguous strings — gather usage context

When meaning is not obvious from the English value + key alone (short labels like “Owner”, “Title”, “Remove”; jargon; UI that depends on who sees it):

1. Run `bun i18n usages <key> --json` (or rely on `usages` already in a pack with `--usages`).
2. Open the listed files and read surrounding UI (who sees it, button vs title vs toast, plurals).
3. Only then translate. Do **not** invent context if usages is empty — use en + sibling `values` / refs, or note ambiguity in the report.

## How locales are wired

| Concern | Where | Who updates it |
|---------|--------|----------------|
| Locale id + label | `packages/domain/src/i18n.ts` `localeLabels` | `bun i18n init-locale` |
| Message file | `apps/web/src/messages/<locale>.json` | `init-locale` + `set` |
| i18next load | `apps/web/src/i18n/setup.ts` (glob) | Automatic |
| Picker flag | `locale-switcher.tsx` `localeFlags` | `init-locale --flag` |
| RTL | `react.tsx` `RTL_LOCALES` | `init-locale --rtl` |

---

## Main agent (after adding/editing en-US)

1. Add/change source strings with `bun i18n add` / `add --stdin` (not hand-edit).
2. Run:

```bash
bun i18n plan --json
# or human: bun i18n plan --prompts
```

3. Follow `mode` — do **not** invent your own dispatch:

| mode | Action |
|------|--------|
| `noop` | Done |
| `oneshot` | Translate all locales yourself (do **not** spawn subagents) |
| `single` | Spawn **one** translator Task; paste `batches[0].prompt` |
| `parallel` | Spawn **one Task per batch** in the **same** message; paste each `batch.prompt` |

4. When translators return (or after oneshot): `bun i18n check --changes-only` must exit 0.

Thresholds (CLI-owned): ≤2 keys → oneshot; 3–8 → single; ≥9 → parallel by language family.

---

## Translator subagent

You receive a batch (locales + keys + pack command + prompt from `plan`).

```bash
# Prefer the packCommand from the plan batch:
bun i18n pack --locales <owned…> --keys <keys…> --usages --json
# For each owned locale with missing/stale keys:
bun i18n set <locale> --stdin
bun i18n check --locale <locale> --changes-only
```

1. Translate every `missing` / `stale` entry in the pack. Preserve `{placeholders}` and rich-text tags.
2. Use in-family `byLocale.*.values` for terminology.
3. **If unclear:** `bun i18n usages <key> --json` and read the UI (see above).
4. Never paste English. `--allow-english` only for brands/proper nouns; list them in the report.
5. Report: locales, key counts, check exit codes, allow-english keys, ambiguous keys.

Family packs (related locales in one agent) are recommended — that is what `plan` parallel batches are.

---

## New language

```bash
bun i18n init-locale <code> --label "…" --flag "…" [--rtl] [--from <related>]
# then pack/set in chunks (--limit), full check --locale (not only --changes-only)
```

---

## CLI cheat sheet

```bash
bun i18n plan [--json] [--prompts] [--mode oneshot|single|parallel]
bun i18n pack --locales a,b --keys k1,k2 --usages --json
bun i18n pack --locale L --refs a,b --usages --json [--changes-only] [--limit N]
bun i18n set L --stdin [--dry-run] [--allow-english]
bun i18n usages Some.key --json
bun i18n check [--locale L] [--changes-only]
bun i18n init-locale code --label "…" --flag "…"
bun i18n help
```
