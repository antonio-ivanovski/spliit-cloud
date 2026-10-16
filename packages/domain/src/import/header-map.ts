/**
 * Generic header-label kit for group importers.
 *
 * Every importer matches localized column labels (`Date`/`Fecha`/`Datum`…) and
 * per-member prefix columns (`Paid by <Name>`, `Impacted to <Name>`). This
 * module is the single implementation; per-provider `*-headers.ts` files are
 * thin label tables + discriminators over it.
 */

export function normalizeHeaderLabel(value: string | undefined): string {
  return (value ?? '').trim().normalize('NFC')
}

export type CoreLabelTable = Record<string, readonly string[]>

export type CoreLabelSets<T extends CoreLabelTable> = {
  [K in keyof T]: Set<string>
}

export function defineCoreLabels<T extends CoreLabelTable>(
  labels: T,
): CoreLabelSets<T> {
  return Object.fromEntries(
    Object.entries(labels).map(([key, list]) => [
      key,
      new Set((list as readonly string[]).map(normalizeHeaderLabel)),
    ]),
  ) as CoreLabelSets<T>
}

export function isCoreLabel(
  sets: Record<string, Set<string>>,
  key: string,
  value: string | undefined,
): boolean {
  return sets[key]?.has(normalizeHeaderLabel(value)) ?? false
}

export function findCoreIndex(
  header: readonly (string | undefined)[],
  sets: Record<string, Set<string>>,
  key: string,
): number {
  return header.findIndex((cell) => isCoreLabel(sets, key, cell))
}

export type PrefixMatcher = {
  /** Participant name from a prefixed column, or null. */
  match: (value: string | undefined) => string | null
}

export function definePrefixMatcher(
  prefixes: readonly string[],
): PrefixMatcher {
  return {
    match: (value: string | undefined): string | null => {
      const normalized = normalizeHeaderLabel(value)
      for (const prefix of prefixes) {
        if (
          normalized.startsWith(prefix) &&
          normalized.length > prefix.length
        ) {
          return normalized.slice(prefix.length).trim()
        }
      }
      return null
    },
  }
}

/**
 * Exact ordered header row: every cell must equal the expected label at the
 * same index (`Array.every` + length check). For fixed-layout exports (Cospend
 * sections, legacy Spliit CSV base columns) where the header is an exact wire
 * contract, not a localized label set.
 */
export function isExactHeaderRow(
  row: readonly (string | undefined)[] | undefined,
  expected: readonly string[],
): boolean {
  if (!row) return false
  if (row.length < expected.length) return false
  return expected.every(
    (cell, i) => normalizeHeaderLabel(row[i]) === normalizeHeaderLabel(cell),
  )
}
