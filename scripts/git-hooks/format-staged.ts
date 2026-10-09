#!/usr/bin/env bun
/**
 * Format staged files with oxfmt and re-stage the result.
 *
 * Only files already in the git index are touched, so the hook never formats
 * unrelated worktree changes. Run via `bun run format:staged`, or import
 * `formatStaged` from the pre-commit hook.
 */
import { execFileSync, spawnSync } from 'node:child_process'

const FORMATTABLE_EXTENSIONS = new Set([
  'js',
  'cjs',
  'mjs',
  'jsx',
  'ts',
  'cts',
  'mts',
  'tsx',
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'html',
  'css',
  'scss',
  'less',
  'md',
  'mdx',
  'graphql',
  'gql',
])

// Generated or vendored files oxfmt is configured to ignore (see
// oxfmt.config.ts and turbo.json). Staged copies are left alone.
const IGNORED_BASENAMES = new Set([
  'routeTree.gen.ts',
  'announcement-content.generated.ts',
])

const IGNORED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vitest',
  '.auth',
  'test-results',
  'playwright-report',
  'generated',
])

function isFormattable(path: string): boolean {
  const segments = path.split('/')
  const basename = segments[segments.length - 1]
  if (IGNORED_BASENAMES.has(basename)) return false
  // Mirrors the `!src/components/ui/**` turbo input exclusion.
  if (
    segments.some(
      (segment, index) =>
        segment === 'components' && segments[index + 1] === 'ui',
    )
  )
    return false
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return false
  const dot = basename.lastIndexOf('.')
  if (dot === -1) return false
  return FORMATTABLE_EXTENSIONS.has(basename.slice(dot + 1))
}

function repoRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim()
}

function stagedFiles(root: string): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
  return output.split('\0').filter((file) => file.length > 0)
}

export function formatStaged(): number {
  const root = repoRoot()
  const files = stagedFiles(root).filter(isFormattable)

  if (files.length === 0) {
    console.log('format:staged: no formattable staged files')
    return 0
  }

  console.log(`format:staged: formatting ${files.length} staged file(s)`)
  const format = spawnSync('bun', ['x', 'oxfmt', '--', ...files], {
    cwd: root,
    stdio: 'inherit',
  })
  if (format.status !== 0) {
    console.error('format:staged: oxfmt failed, commit aborted')
    return format.status ?? 1
  }

  const add = spawnSync('git', ['add', '--', ...files], {
    cwd: root,
    stdio: 'inherit',
  })
  if (add.status !== 0) {
    console.error('format:staged: git add failed, commit aborted')
    return add.status ?? 1
  }

  return 0
}

if (import.meta.main) {
  process.exit(formatStaged())
}
