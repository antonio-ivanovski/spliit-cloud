import {
  boost,
  containsAny,
  demote,
  hasWord,
  type CalibrateArgs,
} from '../utils'

// 5A: restaurant signals — "indian house" vs household-supplies, beer at place vs liquor
export function applyDining({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  let out = ranked

  if (/indian\s+house/i.test(needle)) {
    out = boost(out, 'dining-out', 0.92)
    out = demote(out, 'household-supplies', 0.5)
  }

  if (
    hasWord(needle, 'beer') &&
    / at /i.test(needle) &&
    needle.split(' ').length >= 3
  ) {
    out = boost(out, 'dining-out', 0.78)
    if (needle.split(' ').length >= 4) {
      out = boost(out, 'dining-out', 0.92)
      out = demote(out, 'liquor', 0.6)
    }
  }

  if (
    containsAny(needle, [
      'restaurant',
      'dinner',
      'lunch',
      'brunch',
      'cafe',
      'coffee',
      'takeout',
      'delivery',
    ])
  ) {
    out = demote(out, 'household-supplies', 0.5)
  }

  return out
}
