import {
  boost,
  containsAny,
  demote,
  hasWord,
  type CalibrateArgs,
} from '../utils'

// 4A: shopping => clothing not personal-care (but not when grocery context)
export function applyShopping({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  if (!hasWord(needle, 'shopping')) return ranked
  const grocerySignal = containsAny(needle, [
    'grocery',
    'groceries',
    'supermarket',
    'market',
    'coop',
    'albert',
    'penny',
    'netto',
    'hofer',
    'lidl',
    'aldi',
    'costco',
    'spar',
    'carrefour',
    'rewe',
    'edeka',
    'bazar',
    'veritas',
    'tegut',
    'spesa',
    'pazar',
    'pazarenje',
  ])
  if (grocerySignal) {
    let out = boost(ranked, 'groceries', 0.92)
    out = demote(out, 'clothing', 0.5)
    return out
  }
  let out = boost(ranked, 'clothing', 0.92)
  out = demote(out, 'personal-care-and-wellness', 0.5)
  return out
}
