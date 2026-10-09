#!/usr/bin/env bun
/**
 * Git pre-commit hook: format staged files, then lint changed packages.
 *
 * Formatting runs directly on staged files (mutating tasks can't use the Turbo
 * cache). Checks run through `bun run check:hook`, which limits Turbo to
 * packages with uncommitted changes so unchanged packages hit FULL TURBO cache.
 * Type checks stay in CI (`bun run check`) — `tsc --noEmit` is too slow for
 * every commit.
 *
 * Installed via `bun run setup-hooks`. Bypass with `git commit --no-verify`.
 */
import { spawnSync } from 'node:child_process'

import { formatStaged } from './format-staged'

const formatted = formatStaged()
if (formatted !== 0) {
  process.exit(formatted)
}

const checks = spawnSync('bun', ['run', 'check:hook'], { stdio: 'inherit' })
process.exit(checks.status ?? 1)
