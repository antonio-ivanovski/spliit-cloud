import type { PersonalImportMatch } from '../api'

export function duplicateBadgeLabel(
  matches: PersonalImportMatch[],
  t: (key: string) => string,
): string | null {
  if (matches.length === 0) return null
  if (matches.some((match) => match.kind === 'EXACT_IMPORT')) {
    return t('import.duplicateExact')
  }
  if (matches.some((match) => match.kind === 'CURRENT_FILE')) {
    return t('import.duplicateCurrentFile')
  }
  if (matches.some((match) => match.source === 'GROUP')) {
    return t('import.duplicateShared')
  }
  return t('import.duplicateExisting')
}
