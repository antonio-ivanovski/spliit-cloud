import { locales, type Locale } from '../../../packages/domain/src/i18n.ts'
import {
  classifyEnglishIdentity,
  englishIdentityError,
} from './english-identity'
import { readMessagesFile, writeMessagesFile } from './fs-helpers'
import { expectedKeysForLocale } from './message-validation'
import {
  cleanupEmptyParents,
  flattenKeys,
  getAt,
  removeAt,
  setAt,
  setAtOrdered,
  type Path,
} from './object-path'

export async function addString(path: Path, enValue: string): Promise<void> {
  const data = await readMessagesFile('en-US')
  setAt(data, path, enValue)
  await writeMessagesFile('en-US', data)
}

export type SetStringOptions = {
  allowEnglish?: boolean
  dryRun?: boolean
}

export type SetStringsResult = {
  count: number
  allowEnglishKeys: string[]
  dryRun: boolean
}

function assertTranslationAllowed(
  locale: Locale,
  path: string,
  value: string,
  enValue: unknown,
  allowEnglish: boolean,
): 'ok' | 'allow-english' {
  if (locale === 'en-US') return 'ok'
  if (typeof enValue !== 'string') {
    throw new Error(`key "${path}" does not exist in en-US`)
  }
  const identity = classifyEnglishIdentity(enValue, value, { allowEnglish })
  if (identity.identical && !identity.allowed) {
    throw new Error(englishIdentityError(locale, path))
  }
  if (identity.identical && identity.allowed && identity.reason === 'flag') {
    return 'allow-english'
  }
  return 'ok'
}

export async function setString(
  locale: Locale,
  path: Path,
  value: string,
  opts: SetStringOptions = {},
): Promise<SetStringsResult> {
  const pathStr = Array.isArray(path) ? path.join('.') : path
  const data = await readMessagesFile(locale)
  const enData = locale === 'en-US' ? data : await readMessagesFile('en-US')
  const enValue = getAt(enData, path)
  const flag = assertTranslationAllowed(
    locale,
    pathStr,
    value,
    enValue,
    !!opts.allowEnglish,
  )

  if (opts.dryRun) {
    return {
      count: 1,
      allowEnglishKeys: flag === 'allow-english' ? [pathStr] : [],
      dryRun: true,
    }
  }

  if (locale === 'en-US') {
    setAt(data, path, value)
  } else {
    setAtOrdered(data, path, value, enData)
  }
  await writeMessagesFile(locale, data)
  return {
    count: 1,
    allowEnglishKeys: flag === 'allow-english' ? [pathStr] : [],
    dryRun: false,
  }
}

export async function setStrings(
  locale: Locale,
  entries: Record<string, string>,
  opts: SetStringOptions = {},
): Promise<SetStringsResult> {
  const paths = Object.keys(entries)
  if (paths.length === 0) {
    return { count: 0, allowEnglishKeys: [], dryRun: !!opts.dryRun }
  }

  const data = await readMessagesFile(locale)
  const enData = locale === 'en-US' ? data : await readMessagesFile('en-US')
  const allowEnglishKeys: string[] = []

  for (const path of paths) {
    const value = entries[path]
    if (typeof value !== 'string') {
      throw new Error(`value for "${path}" must be a string`)
    }
    const enValue = getAt(enData, path)
    const flag = assertTranslationAllowed(
      locale,
      path,
      value,
      enValue,
      !!opts.allowEnglish,
    )
    if (flag === 'allow-english') allowEnglishKeys.push(path)
  }

  if (opts.dryRun) {
    return { count: paths.length, allowEnglishKeys, dryRun: true }
  }

  for (const path of paths) {
    if (locale === 'en-US') {
      setAt(data, path, entries[path])
    } else {
      setAtOrdered(data, path, entries[path], enData)
    }
  }
  await writeMessagesFile(locale, data)
  return { count: paths.length, allowEnglishKeys, dryRun: false }
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

export async function missingKeys(
  target: Locale,
  source: Locale = 'en-US',
): Promise<string[]> {
  const [sourceData, targetData] = await Promise.all([
    readMessagesFile(source),
    readMessagesFile(target),
  ])
  const sourceKeys = expectedKeysForLocale(flattenKeys(sourceData), target)
  const targetKeys = new Set(flattenKeys(targetData))
  return sourceKeys.filter((k) => !targetKeys.has(k)).sort()
}
