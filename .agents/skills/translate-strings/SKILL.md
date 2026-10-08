---
name: translate-strings
description: Translate or add locales via bun i18n (plan / next / set / init-locale), using the shared and per-locale translation guides supplied by the CLI. Do not explore the repo or web-search for i18n conventions — this skill, the guides, and the CLI are enough. Use when adding a language (e.g. Swedish), filling missing keys, or dispatching translators after en-US edits.
license: MIT
---

# Translate strings

## Do not waste turns

- **Do NOT** launch explore/subagents to discover how i18n works — this skill + `bun i18n help` are authoritative.
- **Do NOT** web-search / Exa / GitHub-search this project for locale conventions.
- **Do NOT** hand-read `apps/web/src/messages/*.json` to pick work — use `bun i18n next` / `pack`.
- **Do NOT** hand-read messages with `python3 -c json.load` / `node -e` one-liners — use `bun i18n get <key> --locales a,b --json` or `pack --json`.
- **Do NOT** pipe translations via `echo` / `printf` into `--stdin` — shell quoting breaks on apostrophes, quotes, `$`, backticks, and Unicode. Write JSON with the Write tool and use `--file`.
- **Do NOT** invent `--offset`; `next` always returns the next unfinished batch after you `set`.

## Hard rules

- Never paste English into another locale as a placeholder (`set` rejects it).
- Never hand-edit message JSON. Never `bun i18n add` while translating (that writes en-US).
- Translators own only their batch locales.
- Ambiguous strings → `bun i18n usages <key> --json`, then read the listed UI. No usages → use en + refs; note ambiguity in the report.

## Translation guides (mandatory)

- Before translating, read `scripts/i18n/guides/default.md` and every locale guide listed by `plan`, `pack`, or `next` under `guidePaths`.
- The baseline contains rules shared by every locale. The locale file contains the language, region, register, grammar, punctuation, script, terminology, and accessibility nuances that override or extend it.
- Do not rely on general model knowledge when a locale guide gives a project-specific decision. Follow the guide even when a neighboring language uses a tempting cognate.
- Interpolation is configured with single braces: `{name}` and `{count}`. Always write single-brace placeholders, never `{{name}}`/`{{count}}`; preserve the identifier and required rich-text context.
- `bun i18n check` validates the guide inventory and reports doubled placeholders. Do not bypass those errors by copying English or changing placeholder names.

## Locale wiring (do not re-discover)

| Concern            | Where                                 | Updated by             |
| ------------------ | ------------------------------------- | ---------------------- |
| id + label         | `packages/domain/src/i18n.ts`         | `init-locale`          |
| fallback chain     | `localeFallbacks` in same file        | `init-locale --sparse` |
| messages           | `apps/web/src/messages/<locale>.json` | `init-locale` + `set`  |
| i18next load       | glob in `setup.ts`                    | automatic              |
| flag               | `locale-switcher.tsx`                 | `init-locale --flag`   |
| family (plan/refs) | `scripts/i18n/src/families.ts`        | `init-locale --family` |
| guides             | `scripts/i18n/guides/<locale>.md`     | `init-locale --guide`  |
| RTL                | `react.tsx` `RTL_LOCALES`             | `init-locale --rtl`    |

Families: `romance` | `germanic` | `slavic` | `east-asian` | `indic` | `semitic` | `southeast-asian` | `turkic`.

---

## New language (e.g. Swedish)

Example:

```bash
bun i18n init-locale sv-SE --label "Svenska" --flag "🇸🇪" --family germanic --guide path/to/sv-SE-guide.md
```

Then **loop** (no explore, no offset math):

```bash
bun i18n next --locale sv-SE --size 40 --usages --json
# translate result.keys (fill applyTemplate or build {"key":"…"} map),
# write it with the Write tool to /tmp/sv-SE.json, then:
bun i18n set sv-SE --file /tmp/sv-SE.json
# repeat next → set until result.done === true
bun i18n check --locale sv-SE   # full parity; must exit 0
```

`next` auto-advances: it always returns the first N **still-missing** keys. After a successful `set`, the following `next` is the next batch.

Dispatch a translator with a prompt that says exactly that loop and names the guide paths — do not ask them to research the repo.

---

## Sparse overlay locales (`en-GB`, `pt-BR`)

These locales store **only keys that differ from their parent bundle**
(`en-GB → en-US`, `pt-BR → pt → en-US`); missing keys inherit at runtime.

- `bun i18n next --locale en-GB` reports `done` when everything is covered —
  there is no exhaustive backfill loop for overlays.
- For each new `en-US` key, compare against the parent value (`pack` shows it
  as a ref): if identical, **omit the key** — do not `set` it.
- `set` rejects values identical to the inherited parent value. It is not
  bypassable with `--allow-english`; omission is the correct action.
- `bun i18n prune --locale <l>` lists keys that can be dropped back to
  inheritance (dry run; `--write` applies).
- `check --locale <l>` passes when every key is either overridden or inherited.

---

## Main agent (after editing en-US)

```bash
bun i18n plan --json
```

Follow `mode`: `noop` | `oneshot` (you translate) | `single` (one Task) | `parallel` (one Task per family batch, same message). Paste each `batch.prompt`. Then `bun i18n check --changes-only`.

---

## Translator subagent (plan batch or new-locale backfill)

**Plan batch:** read the batch’s `guidePaths`, run its `packCommand`, translate using the baseline plus each owned locale guide, then write per-locale JSON with the Write tool and `set --file` per locale, and run `check --locale --changes-only`.

**Full locale backfill:** read `next.guidePaths`, then use only the `next` → Write → `set --file` loop above until `done`, then full `check --locale`.

---

## Announcements (`packages/domain/src/announcements/<id>/<locale>.md`)

Whole-file translations, not key batches — the `bun i18n` CLI does not track
these files. For each owned locale, author `<locale>.md` next to `en-US.md`:

- Read `scripts/i18n/guides/default.md` plus the owned locale guide(s) first.
- Copy the frontmatter `id`, `date`, `inApp`, `email` verbatim; translate only `title`.
- Translate the body preserving structure (same headings, lists, link positions); link URLs stay verbatim, link labels are translated. Body nodes are constrained to headings, paragraphs, lists, bold/italic, and links — no images or HTML.
- Keep the heading order and count identical to en-US: section anchor ids are derived from the en-US headings, so fragments stay the same in every locale. Never add, remove, merge, or reorder headings.
- Validate with `bun scripts/generate-announcement-content.ts --check` (fails on missing locales or frontmatter/body violations).

---

## CLI cheat sheet

```bash
bun i18n init-locale <code> --label "…" --flag "…" --family germanic|romance|… --guide path/to/<locale>-guide.md
bun i18n init-locale en-AU --label "…" --flag "…" --family germanic --guide path/to/guide.md --sparse --fallback en-GB
bun i18n next --locale L --size 40 --usages --json
bun i18n set L --file /tmp/L.json   # write {"key":"…"} with Write tool; --stdin also works but quoting is fragile
bun i18n get Some.key --locales a,b --json   # never python json.load on messages/*.json
bun i18n prune --locale L [--against P] [--write]   # sparse overlays only
bun i18n plan --json
bun i18n pack --locales a,b --keys k1,k2 --usages --json
bun i18n usages Some.key --json
bun i18n check --locale L
bun i18n help
```
