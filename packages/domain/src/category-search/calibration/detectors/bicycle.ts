import {
  boost,
  containsAny,
  demote,
  hasWord,
  type CalibrateArgs,
} from '../utils'

/**
 * 1A: cycle/bike + rent => bicycle not rent. Covers "Cycle rent at Erhai lake"
 * (was rent:1.0).
 */
export function applyBicycle({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  const hasCycle = containsAny(needle, [
    'cycle',
    'cycling',
    'bicycle',
    'bike',
    'bikeshare',
  ])
  const hasRent = containsAny(needle, ['rent', 'rental', 'hire'])
  if (hasCycle && hasRent) {
    let out = boost(ranked, 'bicycle', 1)
    out = demote(out, 'rent', 0.6)
    return out
  }
  if (hasCycle && !hasRent && hasWord(needle, 'cycling')) {
    return boost(ranked, 'bicycle', 0.92)
  }
  return ranked
}
