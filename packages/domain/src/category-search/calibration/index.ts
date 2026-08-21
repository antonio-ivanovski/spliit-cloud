import type { RankedCategory } from '../rank'
import { applyBicycle } from './detectors/bicycle'
import { applyBusTrain, applyPublicTransport } from './detectors/bus-train'
import { applyDining } from './detectors/dining'
import { applyFoodTights } from './detectors/food-tights'
import { applyGenericBleed } from './detectors/generic-bleed'
import { applyGroceries } from './detectors/groceries'
import { applyHeatGas } from './detectors/heat-gas'
import { applyHousehold } from './detectors/household'
import { applyShopping } from './detectors/shopping'
import { applySiirto } from './detectors/siirto'
import { applyTransitEmoji } from './detectors/transit-emoji'
import type { CalibrateArgs } from './utils'

export type { CalibrateArgs } from './utils'
export { boost, containsAny, demote, hasWord } from './utils'
export { applyBicycle } from './detectors/bicycle'
export { applyBusTrain, applyPublicTransport } from './detectors/bus-train'
export { applyDining } from './detectors/dining'
export { applyFoodTights } from './detectors/food-tights'
export { applyGroceries } from './detectors/groceries'
export { applyHeatGas } from './detectors/heat-gas'
export { applyHousehold } from './detectors/household'
export { applyShopping } from './detectors/shopping'
export { applyGenericBleed } from './detectors/generic-bleed'
export { applySiirto } from './detectors/siirto'
export { applyTransitEmoji } from './detectors/transit-emoji'

/**
 * Calibration overrides for lexical ranker. Applied after rankCategories,
 * before the confident/minScore gate. Composable: each detector is a pure
 * ranked-list transform, individually testable.
 *
 * Order matters: transit-emoji and bus-train first (they widen bus-train), then
 * siirto early-return (nothing else should override a Finnish transfer), then
 * locked 1A–6A detectors and tighten rules.
 */
export function calibrateRankedCategories({
  needle,
  ranked,
}: CalibrateArgs): RankedCategory[] {
  let out = applyTransitEmoji({ needle, ranked })
  out = applyBusTrain({ needle, ranked: out })
  out = applyPublicTransport({ needle, ranked: out })

  const siirto = applySiirto({ needle, ranked: out })
  if (siirto.handled) return siirto.ranked
  out = siirto.ranked

  out = applyBicycle({ needle, ranked: out })
  out = applyShopping({ needle, ranked: out })
  out = applyDining({ needle, ranked: out })
  out = applyFoodTights({ needle, ranked: out })
  out = applyGroceries({ needle, ranked: out })
  out = applyHousehold({ needle, ranked: out })
  out = applyHeatGas({ needle, ranked: out })
  out = applyGenericBleed({ needle, ranked: out })
  return out
}
