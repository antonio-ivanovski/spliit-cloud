import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { PLURAL_SUFFIXES } from './message-validation'

export type UsageHit = {
  file: string
  line: number
  snippet: string
}

const SOURCE_EXT = /\.(tsx?|jsx?)$/
const MAX_HITS = 10

const pluralSuffixPattern = new RegExp(`_(${PLURAL_SUFFIXES.join('|')})$`)

/**
 * Strip plural category suffix for search (previewWillCreate_one →
 * previewWillCreate).
 */
export function usageSearchKey(key: string): string {
  return key.replace(pluralSuffixPattern, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function ancestorPrefixes(
  key: string,
): Array<{ prefix: string; rest: string }> {
  const parts = key.split('.')
  const result: Array<{ prefix: string; rest: string }> = []
  for (let i = 1; i < parts.length; i++) {
    result.push({
      prefix: parts.slice(0, i).join('.'),
      rest: parts.slice(i).join('.'),
    })
  }
  return result
}

function matchLiteralKey(
  content: string,
  key: string,
): Array<{ line: number; snippet: string }> {
  const escaped = escapeRegExp(key)
  const patterns = [
    new RegExp(`\\bt\\(\\s*['\`]${escaped}['\`]`, 'g'),
    new RegExp(`\\bi18nKey\\s*=\\s*['\`]${escaped}['\`]`, 'g'),
    new RegExp(`['"]${escaped}['"]`, 'g'),
  ]
  return collectMatches(content, patterns)
}

function matchRelativeInPrefixedFile(
  content: string,
  prefix: string,
  rest: string,
): Array<{ line: number; snippet: string }> {
  const prefixEsc = escapeRegExp(prefix)
  const hasPrefix = new RegExp(`keyPrefix\\s*:\\s*['\`]${prefixEsc}['\`]`).test(
    content,
  )
  if (!hasPrefix) return []

  const restEsc = escapeRegExp(rest)
  const patterns = [
    new RegExp(`\\bt\\(\\s*['\`]${restEsc}['\`]`, 'g'),
    new RegExp(`\\bi18nKey\\s*=\\s*['\`]${restEsc}['\`]`, 'g'),
  ]
  return collectMatches(content, patterns)
}

function collectMatches(
  content: string,
  patterns: RegExp[],
): Array<{ line: number; snippet: string }> {
  const lines = content.split(/\r?\n/)
  const hits: Array<{ line: number; snippet: string }> = []
  const seen = new Set<number>()

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const before = content.slice(0, match.index)
      const line = before.split(/\r?\n/).length
      if (seen.has(line)) continue
      seen.add(line)
      hits.push({
        line,
        snippet: (lines[line - 1] ?? '').trim().slice(0, 160),
      })
    }
  }
  return hits
}

async function walkSourceFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (SOURCE_EXT.test(entry.name)) out.push(full)
    }
  }
  await walk(root)
  return out
}

export type FindUsagesOptions = {
  root?: string
  /** Absolute or cwd-relative project root for relative file paths in output. */
  projectRoot?: string
  maxHits?: number
}

/**
 * Best-effort: find where a message key is referenced in app source. Does not
 * resolve dynamic template keys.
 */
export async function findUsages(
  key: string,
  opts: FindUsagesOptions = {},
): Promise<UsageHit[]> {
  const projectRoot = opts.projectRoot ?? process.cwd()
  const root = opts.root ?? join(projectRoot, 'apps/web/src')
  const maxHits = opts.maxHits ?? MAX_HITS
  const searchKey = usageSearchKey(key)

  let rootStat
  try {
    rootStat = await stat(root)
  } catch {
    return []
  }
  if (!rootStat.isDirectory()) return []

  const files = await walkSourceFiles(root)
  const hits: UsageHit[] = []
  const prefixes = ancestorPrefixes(searchKey)

  for (const file of files) {
    if (hits.length >= maxHits) break
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }

    const rel = relative(projectRoot, file).split('\\').join('/')
    const localHits = [
      ...matchLiteralKey(content, searchKey),
      ...prefixes.flatMap(({ prefix, rest }) =>
        matchRelativeInPrefixedFile(content, prefix, rest),
      ),
    ]

    const seenLines = new Set<number>()
    for (const hit of localHits) {
      if (hits.length >= maxHits) break
      if (seenLines.has(hit.line)) continue
      seenLines.add(hit.line)
      hits.push({ file: rel, line: hit.line, snippet: hit.snippet })
    }
  }

  return hits
}

export async function findUsagesForKeys(
  keys: string[],
  opts: FindUsagesOptions = {},
): Promise<Record<string, UsageHit[]>> {
  const result: Record<string, UsageHit[]> = {}
  // Sequential is fine for agent batches; keeps memory bounded.
  for (const key of keys) {
    result[key] = await findUsages(key, opts)
  }
  return result
}
