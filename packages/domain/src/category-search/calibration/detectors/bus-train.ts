import {
  boost,
  containsAny,
  demote,
  hasWord,
  type CalibrateArgs,
} from '../utils'

/**
 * Bus/train and transport detectors. Grouped because they share word lists and
 * the same stopword-bleed demotes (in → insurance/income, to → tolls). Always
 * runs after transit-emoji and before siirto short-circuit.
 */
export function applyBusTrain({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  let out = ranked

  // Simple bus/train word — avoid business/bust/training, and cafe/coffee stays food-and-drink
  if (containsAny(needle, ['bus', 'train'])) {
    const looksLikeTransit =
      /\b(bus|train)\b/i.test(needle) &&
      !containsAny(needle, ['business', 'bust', 'training'])
    if (looksLikeTransit) {
      if (hasWord(needle, 'cafe') || hasWord(needle, 'coffee')) {
        out = demote(out, 'bus-train', 0.6)
      } else {
        out = boost(out, 'bus-train', 0.92)
        out = demote(out, 'insurance', 0.5)
        out = demote(out, 'income', 0.5)
      }
    }
  }

  // 2A: train + ticket(s) → bus-train not tolls
  if (hasWord(needle, 'train') && containsAny(needle, ['ticket', 'tickets'])) {
    out = boost(out, 'bus-train', 0.96)
    out = demote(out, 'tolls', 0.5)
  }

  // Ticket + airport/bus/train/metro/station → bus-train (Ticket Munich Airport – Home)
  if (
    hasWord(needle, 'ticket') &&
    containsAny(needle, ['airport', 'bus', 'train', 'metro', 'station'])
  ) {
    out = boost(out, 'bus-train', 0.96)
    out = demote(out, 'home', 0.5)
    out = demote(out, 'tolls', 0.5)
  }

  // Bus + airport/station/ticket → tolls demote tie-break
  if (
    hasWord(needle, 'bus') &&
    containsAny(needle, ['airport', 'station', 'ticket'])
  ) {
    out = demote(out, 'tolls', 0.5)
  }

  return out
}

export function applyPublicTransport({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  const isPublicTransport = /public\s+transport/i.test(needle)
  const isTransportationTravel =
    hasWord(needle, 'transportation') ||
    hasWord(needle, 'transport') ||
    /transportation\s+in\s/i.test(needle)
  if (
    !(
      isPublicTransport ||
      (isTransportationTravel && !hasWord(needle, 'general'))
    )
  ) {
    return ranked
  }

  const looksLikeTransit =
    isPublicTransport ||
    containsAny(needle, [
      'bus',
      'train',
      'metro',
      'prague',
      'alicante',
      'krakow',
      'porto',
      'beijing',
    ]) ||
    /transportation/.test(needle)
  if (!looksLikeTransit) return ranked

  let out = boost(ranked, 'bus-train', 0.98)
  out = demote(out, 'transportation', 0.55)
  out = demote(out, 'home', 0.6)
  out = demote(out, 'insurance', 0.5)
  out = demote(out, 'income', 0.5)
  out = demote(out, 'tolls', 0.5)
  return out
}
