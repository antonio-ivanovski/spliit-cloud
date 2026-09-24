#!/usr/bin/env bun
/**
 * Cut a versioned release from the evergreen draft.
 *
 * Usage: bun release:prepare vX.Y.Z
 *
 * Moves `releases/next.md` to `releases/vX.Y.Z.md` (plus
 * `releases/assets/next/` if it exists), substitutes the `vNEXT` placeholder
 * with the real version, fills the `**Full Changelog**` compare link, and
 * recreates an empty `releases/next.md` skeleton. Lists every remaining `TBD`
 * hash placeholder for the maintainer to fill before committing and tagging.
 * See `.agents/skills/cut-release/SKILL.md`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function gitOrNull(...args: string[]): string | null {
  try {
    return git(...args)
  } catch {
    return null
  }
}

function slugFromRemote(remote: string | null): string | null {
  if (!remote) return null
  const ssh = remote.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  if (ssh) return ssh[1]
  const https = remote.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  )
  if (https) return https[1]
  return null
}

const tag = process.argv[2]
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('Usage: bun release:prepare vX.Y.Z')
  process.exit(1)
}

const nextMd = join('releases', 'next.md')
const nextAssets = join('releases', 'assets', 'next')
const versionedMd = join('releases', `${tag}.md`)
const versionedAssets = join('releases', 'assets', tag)

if (!existsSync(join(root, nextMd))) {
  console.error(`Missing ${nextMd} — nothing to cut.`)
  process.exit(1)
}
if (existsSync(join(root, versionedMd))) {
  console.error(`${versionedMd} already exists — refusing to overwrite.`)
  process.exit(1)
}

git('mv', nextMd, versionedMd)
if (existsSync(join(root, nextAssets))) {
  git('mv', nextAssets, versionedAssets)
}

let notes = readFileSync(join(root, versionedMd), 'utf8')
notes = notes.replaceAll('`vNEXT`', `\`${tag}\``)
notes = notes.replaceAll('assets/next/', `assets/${tag}/`)

const prev = gitOrNull('describe', '--tags', '--match', 'v*.*.*', '--abbrev=0')
const slug = slugFromRemote(gitOrNull('remote', 'get-url', 'origin'))
if (prev && slug) {
  notes = notes.replace(
    '**Full Changelog**: TBD',
    `**Full Changelog**: [${prev}...${tag}](https://github.com/${slug}/compare/${prev}...${tag})`,
  )
} else {
  console.warn(
    'Could not determine the previous version tag or repo slug — fill the `**Full Changelog**` line by hand.',
  )
}
writeFileSync(join(root, versionedMd), notes)

writeFileSync(
  join(root, nextMd),
  `Welcome to \`vNEXT\`! One or two sentences on what this release is about.

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

- Short entry per user-facing change (\`TBD\` by @TBD)

### 🐛 Bug fixes

- Short entry per fix (\`TBD\` by @TBD)

**Full Changelog**: TBD
`,
)

const placeholders = notes
  .split('\n')
  .map((line, index) => ({ line, index: index + 1 }))
  .filter(({ line }) => line.includes('`TBD`'))

console.log(`Prepared ${versionedMd} and recreated an empty ${nextMd}.`)
if (placeholders.length > 0) {
  console.log(
    `\n${placeholders.length} placeholder(s) left to fill before tagging:`,
  )
  for (const { line, index } of placeholders) {
    console.log(`  ${versionedMd}:${index}: ${line.trim()}`)
  }
} else {
  console.log('\nNo placeholders left.')
}
console.log(
  `\nNext: fill the hashes, review the diff, then commit, tag ${tag}, and push.`,
)
