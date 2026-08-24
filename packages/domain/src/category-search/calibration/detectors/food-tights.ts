import {
  boost,
  containsAny,
  demote,
  hasWord,
  type CalibrateArgs,
} from '../utils'

/**
 * Tighten: bare "Cafe X" / "Coffee at Y" / "Pizza Bassano" => food-and-drink.
 * Single-token pizza / ice cream stay dining-out (legacy bare-ping). Multi-word
 * only, and strong dining phrases (restaurant, delivery apps) opt-out.
 */
export function applyFoodTights({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  const isMultiWord = needle.trim().split(/\s+/).length >= 2
  if (!isMultiWord) return ranked

  const hasGenericFood = containsAny(needle, [
    'cafe',
    'coffee',
    'pizza',
    'burger',
    'gelato',
    'lunch',
    'brunch',
  ])
  const hasIceCream = /ice\s*cream/i.test(needle)
  const hasStrongDining = containsAny(needle, [
    'restaurant',
    'takeout',
    'takeaway',
    'delivery',
    'doordash',
    'uber eats',
    'ubereats',
    'grubhub',
    'wolt',
  ])

  if (!(hasGenericFood || hasIceCream) || hasStrongDining) return ranked

  // "Lunch at IKEA" is a true dining-out venue, not food-and-drink parent
  if (
    (hasWord(needle, 'lunch') || hasWord(needle, 'brunch')) &&
    /\bikea\b/i.test(needle)
  ) {
    return ranked
  }

  let out = boost(ranked, 'food-and-drink', 0.96)
  out = demote(out, 'dining-out', 0.6)
  return out
}
