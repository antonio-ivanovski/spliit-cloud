---
name: translate-strings
description: Translate or add locales via bun i18n (plan / next / set / init-locale). Do not explore the repo or web-search for i18n conventions — this skill and the CLI are enough. Use when adding a language (e.g. Swedish), filling missing keys, or dispatching translators after en-US edits.
license: MIT
---

# Translate strings

## Do not waste turns

- **Do NOT** launch explore/subagents to discover how i18n works — this skill + `bun i18n help` are authoritative.
- **Do NOT** web-search / Exa / GitHub-search this project for locale conventions.
- **Do NOT** hand-read `apps/web/src/messages/*.json` to pick work — use `bun i18n next` / `pack`.
- **Do NOT** invent `--offset`; `next` always returns the next unfinished batch after you `set`.

## Hard rules

- Never paste English into another locale as a placeholder (`set` rejects it).
- Never hand-edit message JSON. Never `bun i18n add` while translating (that writes en-US).
- Translators own only their batch locales.
- Ambiguous strings → `bun i18n usages <key> --json`, then read the listed UI. No usages → use en + refs; note ambiguity in the report.

## Locale wiring (do not re-discover)

| Concern            | Where                                 | Updated by             |
| ------------------ | ------------------------------------- | ---------------------- |
| id + label         | `packages/domain/src/i18n.ts`         | `init-locale`          |
| messages           | `apps/web/src/messages/<locale>.json` | `init-locale` + `set`  |
| i18next load       | glob in `setup.ts`                    | automatic              |
| flag               | `locale-switcher.tsx`                 | `init-locale --flag`   |
| family (plan/refs) | `scripts/i18n/src/families.ts`        | `init-locale --family` |
| RTL                | `react.tsx` `RTL_LOCALES`             | `init-locale --rtl`    |

Families: `romance` | `germanic` | `slavic` | `east-asian` | `other`.

---

## New language (e.g. Swedish)

Example:

```bash
bun i18n init-locale sv-SE --label "Svenska" --flag "🇸🇪" --family germanic
```

Then **loop** (no explore, no offset math):

```bash
bun i18n next --locale sv-SE --size 40 --usages --json
# translate result.keys (fill applyTemplate or build {"key":"…"} map)
bun i18n set sv-SE --stdin
# repeat next → set until result.done === true
bun i18n check --locale sv-SE   # full parity; must exit 0
```

`next` auto-advances: it always returns the first N **still-missing** keys. After a successful `set`, the following `next` is the next batch.

Dispatch a translator with a prompt that says exactly that loop — do not ask them to research the repo.

---

## Main agent (after editing en-US)

```bash
bun i18n plan --json
```

Follow `mode`: `noop` | `oneshot` (you translate) | `single` (one Task) | `parallel` (one Task per family batch, same message). Paste each `batch.prompt`. Then `bun i18n check --changes-only`.

---

## Translator subagent (plan batch or new-locale backfill)

**Plan batch:** run the batch’s `packCommand` / translate / `set` per locale / `check --locale --changes-only`.

**Full locale backfill:** only the `next` → `set` loop above until `done`, then full `check --locale`.

---

## CLI cheat sheet

```bash
bun i18n init-locale <code> --label "…" --flag "…" --family germanic|romance|…
bun i18n next --locale L --size 40 --usages --json
bun i18n set L --stdin
bun i18n plan --json
bun i18n pack --locales a,b --keys k1,k2 --usages --json
bun i18n usages Some.key --json
bun i18n check --locale L
bun i18n help
```
