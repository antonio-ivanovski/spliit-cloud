Welcome to `vNEXT`! One or two sentences on what this release is about.

## Highlights

- Headline one

### Headline one

A short paragraph per headline, with a screenshot where it helps.

![caption](./assets/next/shot.webp)

## What's Changed

### 🚨 Breaking Changes

Omit this section when there are none. Each entry names what breaks,
who is affected, and the exact migration steps.

### 🚀 Features

- Short entry per user-facing change (`TBD` by @TBD)

### 🐛 Bug fixes

- Fixed announcement emails never sending: the worker's audience paging compared account IDs with JS string ordering, which disagrees with Postgres collation ordering for mixed-case IDs and rejected every page as invalid ([`9475674e`](https://github.com/antonio-ivanovski/spliit-cloud/commit/9475674ed50c94645bb666d9f4917e5a42fcf911) by @antonio-ivanovski)
- Removed heading link icons from the update modal; section anchors now only appear on the `/updates` page where they are directly navigable

**Full Changelog**: TBD
