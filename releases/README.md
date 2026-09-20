# Releases

Versioned releases. The public instance and `:latest` images follow these versions.

## The flow

`releases/next.md` is the evergreen draft for the upcoming release. As changes land on `main`, append an entry under the right section — no version number or commit hash needed yet:

- End every `What's Changed` entry with ``(`TBD` by @handle)``. The hash is unknowable until the commits are final, so agents and contributors always leave `TBD` and never invent a SHA. Use the contributor's handle, or `@TBD` when unknown.
- Write `` `vNEXT` `` wherever the version number would appear (welcome line, `SPLIIT_TAG=vNEXT`).
- Screenshots go in `releases/assets/next/`, referenced as `./assets/next/<file>` — Markdown (`![]()`) or HTML `<img>` both work; the release workflow rewrites both to pinned absolute URLs.
- Keep `**Full Changelog**: TBD` at the end — it is filled at cut time.

## How to cut a release

1. `bun release:prepare vX.Y.Z` — renames `next.md` (and `assets/next/`) to the version, substitutes `vNEXT`, fills the compare link, recreates an empty `next.md`, and lists every remaining `TBD`.
2. Fill the hashes (short SHAs from `main`), review the diff.
3. Commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `Release` workflow refuses tags whose notes still contain `TBD`. Otherwise it builds the 5 images, publishes `:vX.Y.Z` and `:latest`, creates the GitHub Release from your file, and deploys Dokploy + Cloudflare Pages immediately.
5. Verify on the Releases page (text + screenshots render) and check prod `/health/readiness`.

Rollback: point `SPLIIT_TAG` at the previous version (or move `:latest` back) and restore the DB backup if a migration was incompatible.

## Notes file template

Structure the file like Immich releases:

```markdown
Welcome to `vNEXT`! One or two sentences on what this release is about.

## Highlights

- Headline one
- Headline two

### Headline one

A short paragraph per headline, with a screenshot where it helps.

![caption](./assets/next/shot.webp)

### Headline two

...

## What's Changed

### 🚨 Breaking Changes

Omit this section when there are none. Each entry names what breaks,
who is affected, and the exact migration steps.

### 🚀 Features

- Short entry per user-facing change (`TBD` by @TBD)

### 🐛 Bug fixes

- Short entry per fix (`TBD` by @TBD)

**Full Changelog**: TBD
```

Rules:

- Never write a versioned file by hand — `next.md` is the only draft, and `bun release:prepare` does the rename.
- Do not write the Docker-images section yourself — the workflow appends `:vX.Y.Z` + `:latest` pointers for all 5 images.
