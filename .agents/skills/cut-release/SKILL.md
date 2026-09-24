---
name: cut-release
description: Curate, validate, and cut a versioned Spliit release using Git and gh, then verify publication and deployment. Use when asked to prepare, publish, or check a release; use release-notes for everyday draft edits.
---

# Cut a release

Read the [release-notes skill](../release-notes/SKILL.md) for draft format and issue attribution. Release work must already be committed before selecting citations. Do not tag or push until the final notes and release effects have been shown to the user and they explicitly approve the push.

1. Identify the previous `v*.*.*` tag and the intended release commit. Audit the commits and associated PRs in that range for user-visible changes missing from `releases/next.md`. Add clear omissions; ask about uncertain relevance. Flag draft entries that do not belong to the range.
2. Curate the draft around final outcomes. Fix wording and obvious duplication directly; suggest ambiguous merges, removals, or attribution choices to the user. Keep ordinary entries to one or two sentences and highlights selective. Verify issue links and issue authors with `gh issue view ... --json number,url,author`; issue authors and code contributors are distinct credits.
3. Run `bun release:prepare vX.Y.Z` only after the draft is ready. It moves the notes and screenshots to versioned paths, substitutes `vNEXT`, fills the compare link when possible, and creates a fresh draft. Fill each citation with the primary relevant short commit hash linked to its GitHub commit, a linked PR when one exists, and the primary contributor: `([`abc12345`](https://github.com/owner/repo/commit/<full-sha>) by @contributor; [#123](https://github.com/owner/repo/pull/123))`. Confirm the full hash is in `git rev-list <previous-tag>..<target-commit>` and verify its SHA and URL with `gh api repos/{owner}/{repo}/commits/<sha>`. Look up associated PRs with `gh api repos/{owner}/{repo}/commits/<sha>/pulls` and validate the selected PR with `gh pr view`. Never invent or silently substitute a hash, PR, contributor, or issue author. Stop the cut for an unresolved citation or issue credit.
4. Review the versioned notes, compare link, screenshot paths, remaining placeholders, and diff. Do not add a Docker-images section; the workflow appends it. Commit the release files, then present the final notes, validated references, and deployment effects for explicit approval. Only then create and push the `vX.Y.Z` tag.
5. The tag triggers `.github/workflows/release.yml`: five versioned and `:latest` images, a GitHub Release, and production deployment. Verify the release text and screenshots on GitHub, the workflow result, and production `/health/readiness`. For rollback, restore the previous `SPLIIT_TAG` (or move `:latest` back); restore the matching database backup if a migration was incompatible.

The workflow rejects a missing versioned notes file or remaining backticked `TBD` hashes. A failed validation or uncertain attribution is a stop, not a reason to push and repair afterward.
