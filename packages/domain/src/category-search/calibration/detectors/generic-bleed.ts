import { demote, hasWord, type CalibrateArgs } from '../utils'

/**
 * P2 narrow bleed guards for brand substrings that would otherwise auto-apply a
 * wrong category in en-US. - voda vs vodafone (tv-phone): bare "voda" in
 * English is water, not telecom. - orange vs "orange juice" sample: bare
 * "orange" and "Orange bill" should be null; "orange juice" stays groceries. -
 * boulder vs bouldering: bare "boulder" (city) should not be sports; bouldering
 * stays sports.
 */
export function applyGenericBleed({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  let out = ranked
  const hasVodaWord = hasWord(needle, 'voda')
  if (hasVodaWord && !hasWord(needle, 'vodafone')) {
    out = demote(out, 'tv-phone-internet', 0.5)
  }
  if (hasWord(needle, 'orange') && !hasWord(needle, 'juice')) {
    out = demote(out, 'groceries', 0.5)
    out = demote(out, 'tv-phone-internet', 0.5)
  }
  if (hasWord(needle, 'boulder') && !hasWord(needle, 'bouldering')) {
    out = demote(out, 'sports', 0.5)
  }
  return out
}
