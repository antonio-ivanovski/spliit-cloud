/**
 * Guess a sensible default group name from an import filename.
 *
 * Spliit and Splitwise exports don't carry a group name in the file body, so
 * the parsers default to "Imported from CSV"/"Imported from Splitwise". When
 * the filename follows a recognizable Splitwise pattern we can do better:
 *
 * - Personal Splitwise exports use `<first>-<lastInitial>-and-..._<date>_export`
 *   e.g. `antonio-i-and-dejan-i_2026-06-30_export.csv` → "John D. and Jane D."
 * - Group exports use `<group-name>_<date>_export.csv` e.g.
 *   `london_2022_2026-07-01_export.csv` → "London 2022" Empty prefixes are
 *   common when Splitwise cannot export the original group name; those return
 *   null.
 *
 * Per-provider hint rules live here and are referenced by the provider registry
 * (`providers.ts`); `guessGroupNameFromFilename` keeps the historical
 * `(filename, provider)` signature and dispatches to them.
 *
 * Returns `null` when the filename doesn't match a known pattern. The caller
 * should keep the parser's default in that case.
 */
export function guessGroupNameFromFilename(
  filename: string,
  provider?: string | null,
): string | null {
  // Splitwise export-date patterns apply regardless of provider tab, and
  // take precedence (historical order). The Cospend dated-slug shape
  // (`<slug>_<date>.csv`) is likewise provider-independent; only the bare
  // slug stays COSPEND-gated.
  const splitwise = splitwiseFilenameHint(filename)
  if (splitwise) return splitwise
  const dated = cospendDatedSlugHint(filename)
  if (dated) return dated
  if (!provider) return null
  return filenameHintForSourceProvider(filename, provider)
}

export function filenameHintForSourceProvider(
  filename: string,
  provider: string | null | undefined,
): string | null {
  switch (provider) {
    case 'SPLITWISE':
      return splitwiseFilenameHint(filename)
    case 'COSPEND':
      return cospendFilenameHint(filename)
    case 'TRICOUNT':
      return tricountFilenameHint(filename)
    case 'SETTLEUP':
      return settleUpFilenameHint(filename)
    default:
      return null
  }
}

export function splitwiseFilenameHint(filename: string): string | null {
  const base = filename.replace(/\.(csv|json)$/i, '')

  const personalMatch = base.match(/^(.+)_(\d{4}-\d{2}-\d{2})_export$/)
  if (personalMatch) {
    const prefix = personalMatch[1]!
    if (prefix.includes('-and-')) {
      const segments = prefix.split('-and-')
      const formatted = segments
        .map(formatPersonalSegment)
        .filter((s): s is string => s !== null)
      if (formatted.length === segments.length && formatted.length > 0) {
        return formatted.join(' and ')
      }
    }
  }

  const groupMatch = base.match(/^(.*)_(\d{4}-\d{2}-\d{2})_export$/)
  if (groupMatch) {
    const prefix = groupMatch[1]!.trim()
    if (!prefix || /^\d+$/.test(prefix)) return null
    return humanizeGroupPrefix(prefix)
  }

  return null
}

export function cospendFilenameHint(filename: string): string | null {
  const dated = cospendDatedSlugHint(filename)
  if (dated) return dated

  const slug = filename.replace(/\.(csv|json)$/i, '').trim()
  if (slug && !/^\d+$/.test(slug)) return humanizeGroupPrefix(slug)
  return null
}

function cospendDatedSlugHint(filename: string): string | null {
  const base = filename.replace(/\.(csv|json)$/i, '')
  // Cospend project exports are named `<slug>_<date>.csv` (or `<slug>.csv`).
  // The slug is a lossy lowercased version of the project name (umlauts
  // stripped, spaces → hyphens/underscores); humanize it as a default. The
  // date-suffixed form is matched first so a bare slug is a last resort.
  const cospendDated = base.match(/^(.+)_(\d{4}-\d{2}-\d{2})$/)
  if (cospendDated) {
    const prefix = cospendDated[1]!.trim()
    if (prefix && !/^\d+$/.test(prefix)) return humanizeGroupPrefix(prefix)
  }
  return null
}

export function tricountFilenameHint(filename: string): string | null {
  const base = filename.replace(/\.(csv|json)$/i, '')
  // Tricount GDPR dumps already name the group in `tricount <name> -
  // Exported on …` footers; the filename is only a last-resort fallback
  // (e.g. `transactions-city-trip.csv` → "Transactions City Trip").
  const stem = base.replace(/^transactions-/, '').trim()
  if (stem && !/^\d+$/.test(stem)) return humanizeGroupPrefix(stem)
  return null
}

export function settleUpFilenameHint(filename: string): string | null {
  const base = filename.replace(/\.(csv|json)$/i, '')
  // Settle Up CSV history exports carry no group name in the file body;
  // the attachment name is the only hint (e.g. `my-trip.csv` → "My Trip").
  const stem = base.trim()
  if (stem && !/^\d+$/.test(stem)) return humanizeGroupPrefix(stem)
  return null
}

export function humanizeGroupPrefix(prefix: string): string | null {
  const words = prefix.split(/[_-]+/).filter(Boolean)
  if (words.length === 0) return null
  return words.map(capitalizeWord).join(' ')
}

function capitalizeWord(word: string): string {
  return word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
}

function formatPersonalSegment(seg: string): string | null {
  const parts = seg.split('-').filter(Boolean)
  if (parts.length === 0) return null
  return parts.map(capitalizeWord).join(' ') + '.'
}
