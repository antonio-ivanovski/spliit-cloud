import { execSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { locales, type Locale } from '../../../packages/domain/src/i18n.ts'

export { locales, type Locale }

export const LOCALE_TO_FILE: Record<Locale, string> = {
  'en-US': 'en-US.json',
  ca: 'ca.json',
  'cs-CZ': 'cs-CZ.json',
  'de-DE': 'de-DE.json',
  es: 'es.json',
  eu: 'eu.json',
  fi: 'fi.json',
  'fr-FR': 'fr-FR.json',
  he: 'he.json',
  id: 'id.json',
  'it-IT': 'it-IT.json',
  'ja-JP': 'ja-JP.json',
  ko: 'ko.json',
  'mk-MK': 'mk-MK.json',
  'nl-NL': 'nl-NL.json',
  'pl-PL': 'pl-PL.json',
  pt: 'pt.json',
  'pt-BR': 'pt-BR.json',
  ro: 'ro.json',
  'ru-RU': 'ru-RU.json',
  'tr-TR': 'tr-TR.json',
  'uk-UA': 'uk-UA.json',
  'zh-CN': 'zh-CN.json',
  'zh-TW': 'zh-TW.json',
}

let messagesDir: string = join(process.cwd(), 'apps/web/src/messages')

export function getMessagesDir(): string {
  return messagesDir
}

export function setMessagesDir(dir: string): void {
  messagesDir = dir
}

function fileFor(locale: Locale): string {
  return join(messagesDir, LOCALE_TO_FILE[locale])
}

function gitPathFor(locale: Locale): string {
  return `apps/web/src/messages/${LOCALE_TO_FILE[locale]}`
}

export type Path = string | readonly string[]

export type DiffResult = {
  ref: string
  thisChange: {
    added: string[]
    modified: string[]
    removed: string[]
  }
  translationWork: Record<string, { missing: string[]; present: string[] }>
  legacyMissing: Record<string, number>
}

export type ValidationResult = {
  valid: boolean
  errors: string[]
}

function parsePath(path: Path): string[] {
  if (Array.isArray(path)) return [...path]
  return path.split('.').filter((s) => s.length > 0)
}

export async function readMessagesFile(
  locale: Locale,
): Promise<Record<string, unknown>> {
  const content = await readFile(fileFor(locale), 'utf8')
  return JSON.parse(content)
}

async function writeMessagesFile(
  locale: Locale,
  data: Record<string, unknown>,
): Promise<void> {
  const content = JSON.stringify(data, null, 2) + '\n'
  await writeFile(fileFor(locale), content)
}

export function getAt(obj: unknown, path: Path): unknown {
  const segments = parsePath(path)
  let current: unknown = obj
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[seg]
  }
  return current
}

export function setAt(
  obj: Record<string, unknown>,
  path: Path,
  value: unknown,
): void {
  const segments = parsePath(path)
  if (segments.length === 0) {
    throw new Error('setAt: empty path')
  }
  let current: Record<string, unknown> = obj
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    const next = current[seg]
    if (next == null || typeof next !== 'object' || Array.isArray(next)) {
      current[seg] = {}
    }
    current = current[seg] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}

export function removeAt(obj: Record<string, unknown>, path: Path): boolean {
  const segments = parsePath(path)
  if (segments.length === 0) return false
  let current: Record<string, unknown> = obj
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    const next = current[seg]
    if (next == null || typeof next !== 'object') return false
    current = next as Record<string, unknown>
  }
  const last = segments[segments.length - 1]
  if (!(last in current)) return false
  delete current[last]
  return true
}

export function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return []
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

export function reorderSiblings(
  parent: Record<string, unknown>,
  reference: Record<string, unknown>,
  key: string,
): void {
  if (!(key in parent)) return
  const refKeys = Object.keys(reference)
  const refIndex = refKeys.indexOf(key)
  if (refIndex === -1) return

  let insertBefore: string | null = null
  for (let i = refIndex + 1; i < refKeys.length; i++) {
    if (refKeys[i] in parent) {
      insertBefore = refKeys[i]
      break
    }
  }

  const value = parent[key]
  const rebuilt: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parent)) {
    if (k === key) continue
    if (k === insertBefore) rebuilt[key] = value
    rebuilt[k] = v
  }
  if (insertBefore === null) rebuilt[key] = value

  for (const k of Object.keys(parent)) delete parent[k]
  Object.assign(parent, rebuilt)
}

function setAtOrdered(
  obj: Record<string, unknown>,
  path: Path,
  value: unknown,
  reference: Record<string, unknown>,
): void {
  setAt(obj, path, value)
  const segments = parsePath(path)
  if (segments.length === 0) return
  const lastKey = segments[segments.length - 1]
  const parentPath = segments.slice(0, -1)
  const parent =
    parentPath.length === 0
      ? obj
      : (getAt(obj, parentPath) as Record<string, unknown>)
  const refParent =
    parentPath.length === 0
      ? reference
      : (getAt(reference, parentPath) as Record<string, unknown> | null)
  if (parent != null && refParent != null && typeof refParent === 'object') {
    reorderSiblings(parent, refParent, lastKey)
  }
}

export async function addString(path: Path, enValue: string): Promise<void> {
  const data = await readMessagesFile('en-US')
  setAt(data, path, enValue)
  await writeMessagesFile('en-US', data)
}

export async function setString(
  locale: Locale,
  path: Path,
  value: string,
): Promise<void> {
  const data = await readMessagesFile(locale)
  if (locale === 'en-US') {
    setAt(data, path, value)
  } else {
    const ref = await readMessagesFile('en-US')
    setAtOrdered(data, path, value, ref)
  }
  await writeMessagesFile(locale, data)
}

export async function removeString(path: Path): Promise<number> {
  let count = 0
  for (const locale of locales) {
    const data = await readMessagesFile(locale)
    if (removeAt(data, path)) {
      cleanupEmptyParents(data, path)
      await writeMessagesFile(locale, data)
      count++
    }
  }
  return count
}

function cleanupEmptyParents(obj: Record<string, unknown>, path: Path): void {
  const segments = parsePath(path)
  let depth = segments.length - 1
  while (depth >= 1) {
    const parentPath = segments.slice(0, depth)
    const parent = parentPath.length === 0 ? obj : getAt(obj, parentPath)
    if (
      parent != null &&
      typeof parent === 'object' &&
      !Array.isArray(parent) &&
      Object.keys(parent as Record<string, unknown>).length === 0
    ) {
      const key = segments[depth - 1]
      const grandparentPath = segments.slice(0, depth - 1)
      const grandparent =
        grandparentPath.length === 0
          ? obj
          : (getAt(obj, grandparentPath) as Record<string, unknown>)
      delete grandparent[key]
      depth--
    } else {
      break
    }
  }
}

export async function missingKeys(
  target: Locale,
  source: Locale = 'en-US',
): Promise<string[]> {
  const [sourceData, targetData] = await Promise.all([
    readMessagesFile(source),
    readMessagesFile(target),
  ])
  const sourceKeys = flattenKeys(sourceData)
  const targetKeys = new Set(flattenKeys(targetData))
  return sourceKeys.filter((k) => !targetKeys.has(k)).sort()
}

async function readGitBlob(
  ref: string,
  locale: Locale,
): Promise<Record<string, unknown> | null> {
  const relPath = gitPathFor(locale)
  try {
    const content = execSync(`git show ${ref}:${relPath}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function readStagedBlob(
  locale: Locale,
): Promise<Record<string, unknown> | null> {
  const relPath = gitPathFor(locale)
  try {
    const content = execSync(`git show :${relPath}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return JSON.parse(content)
  } catch {
    return null
  }
}

export async function diffMessages(
  opts: {
    ref?: string
    staged?: boolean
    locale?: Locale
    readOldEn?: () => Promise<Record<string, unknown> | null>
  } = {},
): Promise<DiffResult> {
  const ref = opts.ref ?? 'HEAD'
  const enNow = await readMessagesFile('en-US')

  const enOld = opts.readOldEn
    ? await opts.readOldEn()
    : opts.staged
      ? await readStagedBlob('en-US')
      : await readGitBlob(ref, 'en-US')

  const oldKeys = new Set(enOld ? flattenKeys(enOld) : [])
  const newKeys = flattenKeys(enNow)
  const newKeySet = new Set(newKeys)

  const added: string[] = []
  const modified: string[] = []
  const removed: string[] = []
  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      added.push(key)
    } else if (getAt(enOld!, key) !== getAt(enNow, key)) {
      modified.push(key)
    }
  }
  for (const key of oldKeys) {
    if (!newKeySet.has(key)) removed.push(key)
  }
  added.sort()
  modified.sort()
  removed.sort()

  const changedKeys = [...added, ...modified]
  const changedKeySet = new Set(changedKeys)

  const targetLocales = opts.locale
    ? locales.filter((l) => l === opts.locale)
    : locales.filter((l) => l !== 'en-US')

  const translationWork: Record<
    string,
    { missing: string[]; present: string[] }
  > = {}
  const legacyMissing: Record<string, number> = {}
  const allEnKeys = flattenKeys(enNow)

  await Promise.all(
    targetLocales.map(async (locale) => {
      const data = await readMessagesFile(locale)
      const presentKeys = new Set(flattenKeys(data))

      const missing: string[] = []
      const present: string[] = []
      for (const key of changedKeys) {
        if (presentKeys.has(key)) present.push(key)
        else missing.push(key)
      }
      translationWork[locale] = { missing, present }

      const legacyCount = allEnKeys.filter(
        (k) => !presentKeys.has(k) && !changedKeySet.has(k),
      ).length
      legacyMissing[locale] = legacyCount
    }),
  )

  return {
    ref,
    thisChange: { added, modified, removed },
    translationWork,
    legacyMissing,
  }
}

export async function validateAllMessages(): Promise<ValidationResult> {
  const errors: string[] = []
  const sourceData = await readMessagesFile('en-US')
  const sourceKeys = new Set(flattenKeys(sourceData))

  await Promise.all(
    locales.map(async (locale) => {
      try {
        const data = await readMessagesFile(locale)
        const localeKeys = flattenKeys(data)
        for (const key of localeKeys) {
          if (!sourceKeys.has(key)) {
            errors.push(
              `${LOCALE_TO_FILE[locale]}: orphan key "${key}" — not present in en-US`,
            )
          }
        }
      } catch (e) {
        errors.push(`${LOCALE_TO_FILE[locale]}: ${(e as Error).message}`)
      }
    }),
  )

  return { valid: errors.length === 0, errors }
}
