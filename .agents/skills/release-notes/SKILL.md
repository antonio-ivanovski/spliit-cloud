---
name: release-notes
description: Maintain Spliit's evergreen release notes while building a user-facing feature or fix, including GitHub issue attribution. Use during feature and bug-fix work; use cut-release for versioned release preparation.
---

# Draft release notes

`releases/next.md` describes the finished user-visible result, not the sequence of commits or revisions that produced it. Update it during user-facing feature and fix work. Prefer one outcome-led entry per feature or fix; revise or merge an existing entry when work is closely related, and use separate entries for unrelated outcomes. Omit internal changes with no user or operator impact.

Keep an ordinary `What's Changed` entry to one or two sentences: what changed for users and any essential upgrade action. Choose Features or Bug fixes by the final outcome. Use `🚨 Breaking Changes` only when compatibility or manual steps require it; state who is affected and the exact steps. Use Highlights for a few major benefits, with a short explanation and a screenshot when helpful. If highlighted, keep the matching `What's Changed` entry brief instead of repeating the paragraph. A small release need not have detailed highlight subsections.

Keep the draft's `vNEXT` version marker and `**Full Changelog**: TBD`. Put screenshots in `releases/assets/next/` and reference them as `./assets/next/<file>` in Markdown or HTML. Do not write a versioned notes file or Docker-images section by hand.

End each `What's Changed` entry with ``(`TBD` by @handle)``; use `@TBD` when the contributor is unknown. Never invent a commit hash or contributor. When the work addresses a GitHub issue, link the issue in the entry and credit the **issue author** separately from the code contributor (for example, `Thanks @reporter for opening [#123](https://github.com/owner/repo/issues/123)`). Check the issue URL and `author.login` with `gh issue view <number-or-url> --json number,url,author`; do not infer authorship from a commenter, assignee, or PR author. If the issue or author cannot be verified, flag the entry for resolution rather than guessing.
