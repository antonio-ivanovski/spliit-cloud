#!/usr/bin/env bun
/**
 * Install the repo's git hooks (symlink `.git/hooks/*` to
 * `scripts/git-hooks/*`). Idempotent: re-running is a no-op. Never overwrites
 * an existing hook that points elsewhere — remove or back up that hook first,
 * then re-run. Run via `bun run setup-hooks`.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS: Record<string, string> = {
  'pre-commit': 'pre-commit.ts',
}

const here = dirname(fileURLToPath(import.meta.url))
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim()
const hooksDir = resolve(
  root,
  execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
    encoding: 'utf8',
  }).trim(),
)

let failed = false

for (const [hook, source] of Object.entries(HOOKS)) {
  const target = join(here, source)
  const dest = join(hooksDir, hook)

  chmodSync(target, 0o755)

  let existing: string | null = null
  try {
    const stat = lstatSync(dest)
    existing = stat.isSymbolicLink() ? readlinkSync(dest) : '(regular file)'
  } catch {
    existing = null
  }

  if (existing !== null) {
    const pointsAtTarget =
      existing !== '(regular file)' && resolve(hooksDir, existing) === target
    if (pointsAtTarget) {
      console.log(`${hook}: already installed`)
      continue
    }
    console.error(
      `${hook}: ${dest} already exists (${existing}) and does not point at ${target}. Remove or back it up, then re-run.`,
    )
    failed = true
    continue
  }

  symlinkSync(target, dest)
  console.log(`${hook}: installed -> ${target}`)
}

process.exit(failed ? 1 : 0)
