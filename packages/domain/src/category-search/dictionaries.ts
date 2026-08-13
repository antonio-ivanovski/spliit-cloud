import * as z from 'zod'

import {
  categoryIdSchema,
  getCategoryById,
  type CategoryId,
} from '../categories'
import { defaultLocale } from '../i18n'
import enUSJson from './dictionaries/en-US.json' with { type: 'json' }
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

const ENGLISH_DICTIONARY = parseLocaleDictionary(enUSJson)

/**
 * Shipped locale dictionary ids. Used for `fr` → `fr-FR` resolution without
 * importing every JSON file into the client bundle.
 */
export const SHIPPED_DICTIONARY_LOCALES = [
  'en-US',
  'fr-FR',
  'de-DE',
  'es',
  'it-IT',
  'fi',
  'pt',
  'pt-BR',
  'cs-CZ',
  'zh-CN',
  'mk-MK',
] as const

export type ShippedDictionaryLocale =
  (typeof SHIPPED_DICTIONARY_LOCALES)[number]

type LocaleDictionaryModule = { default: unknown }

/**
 * Dynamic import() per locale so bundlers emit separate chunks. English is
 * preloaded (fallback + majority locale); Macedonian is not downloaded for an
 * English session.
 */
const LOCALE_DICTIONARY_LOADERS: Record<
  string,
  () => Promise<LocaleDictionaryModule>
> = {
  'fr-FR': () =>
    import('./dictionaries/fr-FR.json', { with: { type: 'json' } }),
  'de-DE': () =>
    import('./dictionaries/de-DE.json', { with: { type: 'json' } }),
  es: () => import('./dictionaries/es.json', { with: { type: 'json' } }),
  'it-IT': () =>
    import('./dictionaries/it-IT.json', { with: { type: 'json' } }),
  fi: () => import('./dictionaries/fi.json', { with: { type: 'json' } }),
  pt: () => import('./dictionaries/pt.json', { with: { type: 'json' } }),
  'pt-BR': () =>
    import('./dictionaries/pt-BR.json', { with: { type: 'json' } }),
  'cs-CZ': () =>
    import('./dictionaries/cs-CZ.json', { with: { type: 'json' } }),
  'zh-CN': () =>
    import('./dictionaries/zh-CN.json', { with: { type: 'json' } }),
  'mk-MK': () =>
    import('./dictionaries/mk-MK.json', { with: { type: 'json' } }),
}

const loadedDictionaries = new Map<string, LocaleDictionary>([
  [defaultLocale, ENGLISH_DICTIONARY],
])
const inflightLoads = new Map<string, Promise<LocaleDictionary | undefined>>()

const documentCacheListeners = new Set<() => void>()

/** Ranker document caches should drop entries when a locale dictionary arrives. */
export function onLocaleDictionaryLoaded(listener: () => void): () => void {
  documentCacheListeners.add(listener)
  return () => {
    documentCacheListeners.delete(listener)
  }
}

function notifyLocaleDictionaryLoaded() {
  for (const listener of documentCacheListeners) listener()
}

/** Map `fr` / `fr-CA` → shipped `fr-FR`, `en` / `en-GZ` → `en-US`. */
export function dictionaryLocaleFor(locale: string): string {
  if ((SHIPPED_DICTIONARY_LOCALES as readonly string[]).includes(locale)) {
    return locale
  }
  const base = locale.split('-')[0]?.toLowerCase()
  if (!base) return locale
  const match = SHIPPED_DICTIONARY_LOCALES.find(
    (key) =>
      key.toLowerCase() === base || key.toLowerCase().startsWith(`${base}-`),
  )
  return match ?? locale
}

export function peekLocaleDictionary(
  locale: string,
): LocaleDictionary | undefined {
  return loadedDictionaries.get(dictionaryLocaleFor(locale))
}

export async function loadLocaleDictionary(
  locale: string,
): Promise<LocaleDictionary | undefined> {
  const key = dictionaryLocaleFor(locale)
  const cached = loadedDictionaries.get(key)
  if (cached) return cached

  const inflight = inflightLoads.get(key)
  if (inflight) return inflight

  const loader = LOCALE_DICTIONARY_LOADERS[key]
  if (!loader) return undefined

  const pending = loader()
    .then((module) => {
      const parsed = parseLocaleDictionary(module.default)
      loadedDictionaries.set(key, parsed)
      inflightLoads.delete(key)
      notifyLocaleDictionaryLoaded()
      return parsed
    })
    .catch((error: unknown) => {
      inflightLoads.delete(key)
      throw error
    })
  inflightLoads.set(key, pending)
  return pending
}

const NON_LATIN_LANGUAGE_PREFIXES = new Set([
  'zh',
  'mk',
  'ja',
  'ko',
  'ru',
  'uk',
  'ar',
  'he',
  'hi',
  'bn',
  'ur',
])

export function isNonLatinDictionaryLocale(locale: string): boolean {
  const base = dictionaryLocaleFor(locale).split('-')[0]?.toLowerCase()
  return base !== undefined && NON_LATIN_LANGUAGE_PREFIXES.has(base)
}

function uniqueTokens(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function englishLatinAliases(categoryId: CategoryId): string[] {
  const category = getCategoryById(categoryId)
  if (!category) return []
  return uniqueTokens([
    category.name,
    category.id.replaceAll('-', ' '),
    ...(ENGLISH_DICTIONARY[categoryId]?.aliases ?? []),
  ])
}

export type CategorySearchFields = {
  aliases: readonly string[]
  samples: readonly string[]
  fallbackAliases: readonly string[]
}

export function resolveCategorySearchFields(
  categoryId: CategoryId,
  locale: string,
  loadedDictionary?: LocaleDictionary,
): CategorySearchFields {
  const shared = SHARED_DICTIONARY[categoryId] ?? []
  const dictLocale = dictionaryLocaleFor(locale)
  const localeEntry = (loadedDictionary ?? peekLocaleDictionary(dictLocale))?.[
    categoryId
  ]
  const useEnglishFallback = dictLocale !== defaultLocale
  const promoteEnglish = isNonLatinDictionaryLocale(dictLocale)

  if (promoteEnglish) {
    return {
      aliases: uniqueTokens([
        ...shared,
        ...(localeEntry?.aliases ?? []),
        ...englishLatinAliases(categoryId),
      ]),
      samples: localeEntry?.samples ?? [],
      fallbackAliases: [],
    }
  }

  return {
    aliases: uniqueTokens([...shared, ...(localeEntry?.aliases ?? [])]),
    samples: localeEntry?.samples ?? [],
    fallbackAliases: useEnglishFallback
      ? (ENGLISH_DICTIONARY[categoryId]?.aliases ?? [])
      : [],
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
