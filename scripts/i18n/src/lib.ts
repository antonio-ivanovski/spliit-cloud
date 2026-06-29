import { locales, type Locale } from '../../../packages/domain/src/i18n.ts'

export { locales, type Locale }

export type { Path } from './object-path'

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

export type LocaleAudit = {
  locale: Locale
  total: number
  present: number
  missing: number
  missingKeys: string[]
  coverage: number
}

export type AuditSummary = {
  localesAudited: number
  localesComplete: number
  localesWithMissing: number
  totalMissing: number
}

export type AuditResult = {
  valid: boolean
  errors: string[]
  totalKeys: number
  changesOnly: boolean
  ref: string
  introducedKeys: string[]
  locales: Record<string, LocaleAudit>
  summary: AuditSummary
}

export type AuditOptions = {
  locale?: Locale
  changesOnly?: boolean
  ref?: string
  readOldEn?: () => Promise<Record<string, unknown> | null>
}

// Re-exports from split modules
export {
  getMessagesDir,
  LOCALE_TO_FILE,
  readMessagesFile,
  setMessagesDir,
} from './fs-helpers'

export {
  cleanupEmptyParents,
  flattenKeys,
  getAt,
  removeAt,
  reorderSiblings,
  setAt,
  setAtOrdered,
} from './object-path'

export { addString, missingKeys, removeString, setString } from './translate'

// ---------------------------------------------------------------------------
// Audit / diff logic — kept in lib.ts as it orchestrates the other modules
// and is the primary public API surface.
// ---------------------------------------------------------------------------

import {
  LOCALE_TO_FILE,
  readGitBlob,
  readMessagesFile,
  readStagedBlob,
} from './fs-helpers'
import { flattenKeys, getAt } from './object-path'

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
        errors.push(`${locale}: ${(e as Error).message}`)
      }
    }),
  )

  return { valid: errors.length === 0, errors }
}

export async function auditMessages(
  opts: AuditOptions = {},
): Promise<AuditResult> {
  const [valResult, enData] = await Promise.all([
    validateAllMessages(),
    readMessagesFile('en-US'),
  ])

  const enKeys = flattenKeys(enData)
  const totalKeys = enKeys.length

  const ref = opts.ref ?? 'HEAD'
  let introducedKeys: string[] = []
  if (opts.changesOnly) {
    const diff = await diffMessages({ ref, readOldEn: opts.readOldEn })
    introducedKeys = [...diff.thisChange.added, ...diff.thisChange.modified]
  }
  const introducedSet = new Set(introducedKeys)

  const targetLocales = opts.locale
    ? locales.filter((l) => l === opts.locale)
    : locales.filter((l) => l !== 'en-US')

  const localesAudit: Record<string, LocaleAudit> = {}
  await Promise.all(
    targetLocales.map(async (locale) => {
      const data = await readMessagesFile(locale)
      const presentSet = new Set(flattenKeys(data))
      let missingKeys = enKeys.filter((k) => !presentSet.has(k))
      if (opts.changesOnly) {
        missingKeys = missingKeys.filter((k) => introducedSet.has(k))
      }
      const presentCount = totalKeys - missingKeys.length
      localesAudit[locale] = {
        locale,
        total: totalKeys,
        present: presentCount,
        missing: missingKeys.length,
        missingKeys,
        coverage: totalKeys === 0 ? 1 : presentCount / totalKeys,
      }
    }),
  )

  let totalMissing = 0
  let localesComplete = 0
  for (const audit of Object.values(localesAudit)) {
    totalMissing += audit.missing
    if (audit.missing === 0) localesComplete++
  }

  return {
    valid: valResult.valid,
    errors: valResult.errors,
    totalKeys,
    changesOnly: !!opts.changesOnly,
    ref,
    introducedKeys,
    locales: localesAudit,
    summary: {
      localesAudited: targetLocales.length,
      localesComplete,
      localesWithMissing: targetLocales.length - localesComplete,
      totalMissing,
    },
  }
}

export async function missingKeysByLocale(): Promise<Record<Locale, string[]>> {
  const enData = await readMessagesFile('en-US')
  const enKeys = flattenKeys(enData)
  const result = {} as Record<Locale, string[]>
  await Promise.all(
    locales
      .filter((l) => l !== 'en-US')
      .map(async (locale) => {
        const data = await readMessagesFile(locale)
        const present = new Set(flattenKeys(data))
        result[locale] = enKeys.filter((k) => !present.has(k))
      }),
  )
  return result
}
