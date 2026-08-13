import * as z from 'zod'

import { categoryIdSchema, type CategoryId } from '../categories'
import { defaultLocale } from '../i18n'
import enUSJson from './dictionaries/en-US.json' with { type: 'json' }
import frFRJson from './dictionaries/fr-FR.json' with { type: 'json' }
import sharedJson from './dictionaries/shared.json' with { type: 'json' }

const tokenSchema = z.string().trim().min(1)

export const localeDictionaryEntrySchema = z.object({
  aliases: z.array(tokenSchema).default([]),
  samples: z.array(tokenSchema).default([]),
})

export type LocaleDictionaryEntry = z.infer<typeof localeDictionaryEntrySchema>

export const localeDictionarySchema = z.partialRecord(
  categoryIdSchema,
  localeDictionaryEntrySchema,
)

export type LocaleDictionary = z.infer<typeof localeDictionarySchema>

export const sharedDictionarySchema = z.partialRecord(
  categoryIdSchema,
  z.array(tokenSchema).min(1),
)

export type SharedDictionary = z.infer<typeof sharedDictionarySchema>

export function parseLocaleDictionary(value: unknown): LocaleDictionary {
  return localeDictionarySchema.parse(value)
}

export function parseSharedDictionary(value: unknown): SharedDictionary {
  return sharedDictionarySchema.parse(value)
}

export const SHARED_DICTIONARY = parseSharedDictionary(sharedJson)

const LOCALE_DICTIONARIES: Record<string, LocaleDictionary> = {
  'en-US': parseLocaleDictionary(enUSJson),
  'fr-FR': parseLocaleDictionary(frFRJson),
}

/** English variants share the en-US synonym list. */
export function dictionaryLocaleFor(locale: string): string {
  if (locale === defaultLocale || locale.startsWith('en')) return defaultLocale
  return locale
}

export type CategorySearchFields = {
  aliases: readonly string[]
  samples: readonly string[]
  fallbackAliases: readonly string[]
}

export function resolveCategorySearchFields(
  categoryId: CategoryId,
  locale: string,
): CategorySearchFields {
  const shared = SHARED_DICTIONARY[categoryId] ?? []
  const dictLocale = dictionaryLocaleFor(locale)
  const localeEntry = LOCALE_DICTIONARIES[dictLocale]?.[categoryId]
  const enEntry = LOCALE_DICTIONARIES[defaultLocale]?.[categoryId]
  const useEnglishFallback = dictLocale !== defaultLocale

  return {
    aliases: [...shared, ...(localeEntry?.aliases ?? [])],
    samples: localeEntry?.samples ?? [],
    fallbackAliases: useEnglishFallback ? (enEntry?.aliases ?? []) : [],
  }
}

/** Tokens already indexed for a category in a locale (for mining diffs). */
export function knownTokensForCategory(
  categoryId: CategoryId,
  locale: string,
): Set<string> {
  const fields = resolveCategorySearchFields(categoryId, locale)
  const tokens = new Set<string>()
  for (const value of [
    ...fields.aliases,
    ...fields.samples,
    ...fields.fallbackAliases,
  ]) {
    for (const token of tokenizeSearchText(value)) {
      tokens.add(token)
    }
  }
  return tokens
}

export function tokenizeSearchText(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}
