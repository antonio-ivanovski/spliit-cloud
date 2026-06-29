import { locales, type Locale } from '../../../packages/domain/src/i18n.ts'
import { readMessagesFile, writeMessagesFile } from './fs-helpers'
import {
  cleanupEmptyParents,
  flattenKeys,
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
