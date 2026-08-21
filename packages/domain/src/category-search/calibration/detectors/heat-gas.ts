import { boost, demote, hasWord, type CalibrateArgs } from '../utils'

/**
 * Heat-gas vs gas-fuel: month abbrev + gas (utility bill cadence), or BEG
 * (Skopje heating) plus gas/bill. ESM is explicitly NOT here — AD ESM is
 * electricity (generator), so esm/есм must not route to heat-gas.
 *
 * Guards:
 *
 * - Month+gas must not be a fuel station (\b(station|fuel|pump)\b)
 * - Beg/бег alone does NOT calibrate — needs gas or bill/invoice cue (mk-MK
 *   dictionary alias handles bare "бег"/"beg" in that locale).
 */
export function applyHeatGas({
  needle,
  ranked,
}: CalibrateArgs): CalibrateArgs['ranked'] {
  const hasMonthGas =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b.*\bgas\b/i.test(
      needle,
    )
  const isFuelStation =
    hasWord(needle, 'station') ||
    hasWord(needle, 'fuel') ||
    hasWord(needle, 'pump')
  if (hasMonthGas && !isFuelStation) {
    let out = boost(ranked, 'heat-gas', 0.96)
    out = demote(out, 'gas-fuel', 0.5)
    return out
  }

  const hasBeg = hasWord(needle, 'beg') || hasWord(needle, 'бег')
  if (hasBeg) {
    const hasGas = hasWord(needle, 'gas')
    const hasBillToken =
      hasWord(needle, 'bill') ||
      hasWord(needle, 'invoice') ||
      hasWord(needle, 'rechnung') ||
      hasWord(needle, 'сметка')
    if (hasGas || hasBillToken) {
      let out = boost(ranked, 'heat-gas', 0.96)
      out = demote(out, 'gas-fuel', 0.5)
      return out
    }
  }

  return ranked
}
