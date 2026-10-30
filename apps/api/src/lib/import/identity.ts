import { createHash } from 'node:crypto'

import { dateOnlyInTimeZone } from '@spliit/domain'

/**
 * Target-neutral file-import identity helpers shared by group and personal
 * bank-CSV pipelines. Extracted from `lib/api/expenses/csv-import.ts` without
 * behavior changes: group import keys must stay byte-identical, so the group
 * domain strings live with the group caller and only the hashing/normalization
 * core lives here.
 */

export type ImportMatchKind =
  | 'EXACT_IMPORT'
  | 'EXISTING_TRANSACTION'
  | 'CURRENT_FILE'

/** Normalize a bank-provided identity component (NFKC + trim, case kept). */
export function normalizedExternalComponent(
  value: string | null | undefined,
): string | null {
  const normalized = (value ?? '').normalize('NFKC').trim()
  return normalized || null
}

export const FILE_IDENTITY_DOMAIN = 'spliit:expense-file-identity:v1'

/**
 * Hash-only bank identity: raw bank transaction ids and account namespaces are
 * hashed at the API boundary and never stored. Null when the export provides no
 * id.
 */
export function externalIdentityHash(
  externalId: string | null | undefined,
  sourceAccount: string | null | undefined,
): string | null {
  const id = normalizedExternalComponent(externalId)
  if (!id) return null
  return createHash('sha256')
    .update(`${FILE_IDENTITY_DOMAIN}\0`)
    .update(normalizedExternalComponent(sourceAccount) ?? '')
    .update('\0')
    .update(id)
    .digest('hex')
}

/** Immutable replay key: sha256(domain + scopeId + originFingerprint). */
export function storedImportKey(
  domain: string,
  scopeId: string,
  originFingerprint: string,
): string {
  return createHash('sha256')
    .update(`${domain}\0`)
    .update(scopeId)
    .update('\0')
    .update(originFingerprint)
    .digest('hex')
}

export function normalizedImportTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export type ImportMatchIdentity = {
  date: string
  amount: number
  currency: string
  title: string
}

export function fuzzyImportMatchKey(identity: ImportMatchIdentity): string {
  return [
    identity.date,
    identity.amount,
    identity.currency,
    normalizedImportTitle(identity.title),
  ].join('\0')
}

export function wallDateIso(expenseDate: Date, timeZone: string): string {
  return dateOnlyInTimeZone(expenseDate, timeZone).toISOString().slice(0, 10)
}

function personalWallDateIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export { personalWallDateIso }

/**
 * Cluster import dates into narrow padded windows. Each window spans [date-1d,
 * date+2d) so a wall date in any UTC-12…UTC+14 zone maps to an instant in that
 * range; dates more than 3 days apart get separate windows.
 */
export function importDateWindows(datesOnly: string[]): Array<{
  gte: Date
  lt: Date
}> {
  const day = 24 * 60 * 60 * 1000
  const sorted = [
    ...new Set(
      datesOnly
        .map((date) => new Date(`${date}T00:00:00.000Z`).getTime())
        .filter(Number.isFinite),
    ),
  ].sort((a, b) => a - b)
  const windows: Array<{ gte: Date; lt: Date }> = []
  let cluster: { min: number; max: number } | null = null
  const flush = () => {
    if (cluster) {
      windows.push({
        gte: new Date(cluster.min - day),
        lt: new Date(cluster.max + 2 * day),
      })
      cluster = null
    }
  }
  for (const time of sorted) {
    if (cluster && time - cluster.max > 3 * day) flush()
    cluster = cluster
      ? { min: cluster.min, max: Math.max(cluster.max, time) }
      : { min: time, max: time }
  }
  flush()
  return windows
}
