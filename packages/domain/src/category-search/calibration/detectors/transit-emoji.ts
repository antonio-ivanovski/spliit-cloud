import { boost, hasWord, type CalibrateArgs } from '../utils'

// Actual rail/bus glyphs — 🚄 high-speed, 🚂 steam, 🚃 tram car, 🚋 tram, 🚆 metro, 🚇 tube, 🚊 tram, 🚉 station, 🚅 bullet, 🚈 light rail, 🚝 monorail, 🚞 mountain, 🚌 bus, 🚍 oncoming bus, 🚎 trolleybus
const TRANSIT_EMOJI_RE = /[🚄🚂🚃🚋🚆🚇🚊🚉🚅🚈🚝🚞🚌🚍🚎]/u

const TRANSIT_WORDS = ['bus', 'train', 'metro', 'tram', 'rail'] as const

/**
 * Emoji detector: only when a real transit emoji appears together with a
 * transit word does it promote bus-train. Bare emoji (🚕 taxi, 🚲 bike, 🚀
 * rocket, 🔵 circle) or emoji + city alone do not.
 */
export function applyTransitEmoji({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  if (!TRANSIT_EMOJI_RE.test(needle)) return ranked
  if (hasWord(needle, 'siirto')) return ranked
  const hasTransitWord = TRANSIT_WORDS.some((word) => hasWord(needle, word))
  if (!hasTransitWord) return ranked
  return boost(ranked, 'bus-train', 0.96)
}
