import {
  boost,
  containsAny,
  demote,
  hasWord,
  type CalibrateArgs,
} from '../utils'

export function applyGroceries({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  if (
    (hasWord(needle, 'coffee') && containsAny(needle, ['beans', 'tchibo'])) ||
    containsAny(needle, ['ingredients', 'ingredient'])
  ) {
    let out = boost(ranked, 'groceries', 0.98)
    out = demote(out, 'food-and-drink', 0.5)
    out = demote(out, 'dining-out', 0.5)
    out = demote(out, 'liquor', 0.5)
    return out
  }
  return ranked
}
