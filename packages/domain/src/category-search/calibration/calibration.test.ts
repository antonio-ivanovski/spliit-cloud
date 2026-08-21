import { describe, expect, it } from 'vitest'

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
import { calibrateRankedCategories } from './index'

function ranked(...entries: Array<[string, number]>): RankedCategory[] {
  return entries.map(([id, score]) => ({
    id: id as RankedCategory['id'],
    score,
    isParent: false,
  }))
}

describe('applySiirto', () => {
  it('boosts payment for siirto and short-circuits', () => {
    const { ranked: out, handled } = applySiirto({
      needle: 'siirto 29.11',
      ranked: ranked(['payment', 0.5]),
    })
    expect(handled).toBe(true)
    expect(out.find((entry) => entry.id === 'payment')!.score).toBe(1)
  })

  it('ignores non-siirto titles', () => {
    const { handled } = applySiirto({
      needle: 'uber to airport',
      ranked: ranked(['taxi', 0.9]),
    })
    expect(handled).toBe(false)
  })
})

describe('applyTransitEmoji', () => {
  it('requires a real transit emoji plus a transit word', () => {
    expect(
      applyTransitEmoji({
        needle: '🚄 munich train',
        ranked: ranked(['bus-train', 0.4]),
      }).find((entry) => entry.id === 'bus-train')!.score,
    ).toBe(0.96)
    // Taxi bike rocket and colored circles are not transit
    expect(
      applyTransitEmoji({
        needle: '🚕 munich',
        ranked: ranked(['bus-train', 0.4]),
      }),
    ).toEqual(ranked(['bus-train', 0.4]))
    expect(
      applyTransitEmoji({
        needle: '🚲 munich',
        ranked: ranked(['bus-train', 0.4]),
      }),
    ).toEqual(ranked(['bus-train', 0.4]))
    expect(
      applyTransitEmoji({
        needle: '🚀 prague',
        ranked: ranked(['bus-train', 0.4]),
      }),
    ).toEqual(ranked(['bus-train', 0.4]))
    expect(
      applyTransitEmoji({
        needle: '🔵 prague',
        ranked: ranked(['bus-train', 0.4]),
      }),
    ).toEqual(ranked(['bus-train', 0.4]))
    // Emoji without transit word does not
    expect(
      applyTransitEmoji({
        needle: '🚄 prague',
        ranked: ranked(['bus-train', 0.4]),
      }),
    ).toEqual(ranked(['bus-train', 0.4]))
  })
})

describe('applyBusTrain', () => {
  it('boosts bus-train for bus/train and demotes bleed', () => {
    const out = applyBusTrain({
      needle: 'bus to airport',
      ranked: ranked(['bus-train', 0.5], ['tolls', 0.9], ['insurance', 0.9]),
    })
    expect(
      out.find((entry) => entry.id === 'bus-train')!.score,
    ).toBeGreaterThanOrEqual(0.92)
    expect(out.find((entry) => entry.id === 'tolls')!.score).toBe(0.5)
    expect(out.find((entry) => entry.id === 'insurance')!.score).toBe(0.5)
  })

  it('does not boost when cafe/coffee present', () => {
    const out = applyBusTrain({
      needle: 'cafe before bus',
      ranked: ranked(['bus-train', 0.9], ['food-and-drink', 0.9]),
    })
    expect(out.find((entry) => entry.id === 'bus-train')!.score).toBe(0.6)
  })

  it('handles train+ticket and ticket+airport', () => {
    const first = applyBusTrain({
      needle: 'high-speed train tickets to dali',
      ranked: ranked(['bus-train', 0.3], ['tolls', 0.9]),
    })
    expect(first.find((entry) => entry.id === 'bus-train')!.score).toBe(0.96)
    const second = applyBusTrain({
      needle: 'ticket munich airport home',
      ranked: ranked(['bus-train', 0.3], ['home', 0.9]),
    })
    expect(second.find((entry) => entry.id === 'bus-train')!.score).toBe(0.96)
  })
})

describe('applyPublicTransport', () => {
  it('routes public transport to bus-train', () => {
    const out = applyPublicTransport({
      needle: 'public transportation alicante',
      ranked: ranked(['transportation', 1], ['bus-train', 0.3]),
    })
    expect(out.find((entry) => entry.id === 'bus-train')!.score).toBe(0.98)
  })
})

describe('applyBicycle', () => {
  it('cycle+rent => bicycle not rent', () => {
    const out = applyBicycle({
      needle: 'cycle rent at erhai lake',
      ranked: ranked(['rent', 1], ['bicycle', 0.3]),
    })
    expect(out.find((entry) => entry.id === 'bicycle')!.score).toBe(1)
    expect(out.find((entry) => entry.id === 'rent')!.score).toBe(0.6)
  })
})

describe('applyShopping', () => {
  it('shopping without grocery => clothing', () => {
    const out = applyShopping({
      needle: 'personal shopping',
      ranked: ranked(['personal-care-and-wellness', 0.9], ['clothing', 0.3]),
    })
    expect(out.find((entry) => entry.id === 'clothing')!.score).toBe(0.92)
  })

  it('shopping with grocery => groceries', () => {
    const out = applyShopping({
      needle: 'shopping at rewe',
      ranked: ranked(['clothing', 0.9], ['groceries', 0.3]),
    })
    expect(out.find((entry) => entry.id === 'groceries')!.score).toBe(0.92)
  })
})

describe('applyDining + applyFoodTights', () => {
  it('indian house => dining-out', () => {
    const out = applyDining({
      needle: 'indian house alicante',
      ranked: ranked(['household-supplies', 0.9], ['dining-out', 0.3]),
    })
    expect(out.find((entry) => entry.id === 'dining-out')!.score).toBe(0.92)
  })

  it('beer at place with 4 words => dining-out over liquor', () => {
    const out = applyDining({
      needle: 'bifana and beer at o trevo',
      ranked: ranked(['liquor', 0.9], ['dining-out', 0.3]),
    })
    expect(out.find((entry) => entry.id === 'dining-out')!.score).toBe(0.92)
    expect(out.find((entry) => entry.id === 'liquor')!.score).toBe(0.6)
  })

  it('cafe x multi-word => food-and-drink, not dining-out, unless ikea', () => {
    // detectors are pure ranked-list transforms: they only re-score entries already present.
    // So "cafe nero" boost appears only when food-and-drink already ranked; "lunch at ikea" keeps the list unchanged.
    expect(
      applyFoodTights({
        needle: 'cafe nero',
        ranked: ranked(['dining-out', 0.9], ['food-and-drink', 0.3]),
      }).find((entry) => entry.id === 'food-and-drink')!.score,
    ).toBe(0.96)
    expect(
      applyFoodTights({
        needle: 'lunch at ikea',
        ranked: ranked(['dining-out', 0.9], ['food-and-drink', 0.3]),
      }),
    ).toEqual(ranked(['dining-out', 0.9], ['food-and-drink', 0.3]))
    expect(
      applyFoodTights({ needle: 'pizza', ranked: ranked(['dining-out', 0.9]) }),
    ).toEqual(ranked(['dining-out', 0.9]))
  })
})

describe('applyGroceries / applyHousehold / applyHeatGas', () => {
  it('coffee beans => groceries', () => {
    const out = applyGroceries({
      needle: 'tchibo coffee beans',
      ranked: ranked(['food-and-drink', 0.9], ['groceries', 0.3]),
    })
    expect(out.find((entry) => entry.id === 'groceries')!.score).toBe(0.98)
  })

  it('things for home => household-supplies', () => {
    const out = applyHousehold({
      needle: 'things for home',
      ranked: ranked(['home', 0.9], ['household-supplies', 0.3]),
    })
    expect(out.find((entry) => entry.id === 'household-supplies')!.score).toBe(
      0.96,
    )
  })

  it('bounty no longer maps to household-supplies; toilet paper still does', () => {
    expect(
      applyHousehold({
        needle: 'bounty',
        ranked: ranked(['household-supplies', 0.4]),
      }),
    ).toEqual(ranked(['household-supplies', 0.4]))
    expect(
      applyHousehold({
        needle: 'Bounty chocolate',
        ranked: ranked(['household-supplies', 0.4]),
      }),
    ).toEqual(ranked(['household-supplies', 0.4]))
    expect(
      applyHousehold({
        needle: 'Bounty paper towels',
        ranked: ranked(['household-supplies', 0.4]),
      }),
    ).toEqual(ranked(['household-supplies', 0.4]))
    expect(
      applyHousehold({
        needle: 'toilet paper',
        ranked: ranked(['household-supplies', 0.3]),
      }).find((entry) => entry.id === 'household-supplies')!.score,
    ).toBe(0.96)
    expect(
      applyHousehold({
        needle: 'essuie-tout',
        ranked: ranked(['household-supplies', 0.3]),
      }).find((entry) => entry.id === 'household-supplies')!.score,
    ).toBe(0.96)
  })

  it('month gas and beg/бег => heat-gas, esm does not; fuel stations and bare beg do not', () => {
    // month+gas utility bill
    expect(
      applyHeatGas({
        needle: 'apr gas bill',
        ranked: ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]),
      }).find((entry) => entry.id === 'heat-gas')!.score,
    ).toBe(0.96)
    expect(
      applyHeatGas({
        needle: 'may gas bill',
        ranked: ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]),
      }).find((entry) => entry.id === 'heat-gas')!.score,
    ).toBe(0.96)
    // month+gas but fuel station must not be heat-gas
    expect(
      applyHeatGas({
        needle: 'may gas station',
        ranked: ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]),
      }),
    ).toEqual(ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]))
    expect(
      applyHeatGas({
        needle: 'jan gas station',
        ranked: ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]),
      }),
    ).toEqual(ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]))
    expect(
      applyHeatGas({
        needle: 'jan gas pump',
        ranked: ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]),
      }),
    ).toEqual(ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]))
    // beg/бег needs gas or bill cue — bare beg does not calibrate
    expect(
      applyHeatGas({
        needle: 'beg',
        ranked: ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]),
      }),
    ).toEqual(ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]))
    expect(
      applyHeatGas({
        needle: 'бег',
        ranked: ranked(['heat-gas', 0.3]),
      }),
    ).toEqual(ranked(['heat-gas', 0.3]))
    expect(
      applyHeatGas({
        needle: 'бег gas bill',
        ranked: ranked(['gas-fuel', 0.9], ['heat-gas', 0.3]),
      }).find((entry) => entry.id === 'heat-gas')!.score,
    ).toBe(0.96)
    expect(
      applyHeatGas({
        needle: 'beg bill',
        ranked: ranked(['heat-gas', 0.3]),
      }).find((entry) => entry.id === 'heat-gas')!.score,
    ).toBe(0.96)
    expect(
      applyHeatGas({
        needle: 'бег сметка',
        ranked: ranked(['heat-gas', 0.3]),
      }).find((entry) => entry.id === 'heat-gas')!.score,
    ).toBe(0.96)
    // esm never heat-gas
    expect(
      applyHeatGas({
        needle: 'esm 03.2024',
        ranked: ranked(['electricity', 0.9], ['heat-gas', 0.3]),
      }),
    ).toEqual(ranked(['electricity', 0.9], ['heat-gas', 0.3]))
    expect(
      applyHeatGas({ needle: 'esm', ranked: ranked(['heat-gas', 0.3]) }),
    ).toEqual(ranked(['heat-gas', 0.3]))
  })
})

describe('applyGenericBleed', () => {
  it('voda without vodafone demotes tv-phone-internet', () => {
    expect(
      applyGenericBleed({
        needle: 'voda',
        ranked: ranked(['tv-phone-internet', 0.9]),
      }).find((entry) => entry.id === 'tv-phone-internet')!.score,
    ).toBe(0.5)
    expect(
      applyGenericBleed({
        needle: 'vodafone',
        ranked: ranked(['tv-phone-internet', 0.9]),
      }).find((entry) => entry.id === 'tv-phone-internet')!.score,
    ).toBe(0.9)
    expect(
      applyGenericBleed({
        needle: 'voda bill',
        ranked: ranked(['tv-phone-internet', 0.9]),
      }).find((entry) => entry.id === 'tv-phone-internet')!.score,
    ).toBe(0.5)
  })

  it('bare orange without juice demotes groceries/tv-phone, orange juice does not', () => {
    expect(
      applyGenericBleed({
        needle: 'orange',
        ranked: ranked(['groceries', 0.9], ['tv-phone-internet', 0.9]),
      }).find((entry) => entry.id === 'groceries')!.score,
    ).toBe(0.5)
    expect(
      applyGenericBleed({
        needle: 'Orange bill',
        ranked: ranked(['groceries', 0.9]),
      }).find((entry) => entry.id === 'groceries')!.score,
    ).toBe(0.5)
    expect(
      applyGenericBleed({
        needle: 'orange juice',
        ranked: ranked(['groceries', 0.9]),
      }).find((entry) => entry.id === 'groceries')!.score,
    ).toBe(0.9)
  })

  it('bare boulder without bouldering demotes sports', () => {
    expect(
      applyGenericBleed({
        needle: 'boulder',
        ranked: ranked(['sports', 0.9]),
      }).find((entry) => entry.id === 'sports')!.score,
    ).toBe(0.5)
    expect(
      applyGenericBleed({
        needle: 'Boulder trip',
        ranked: ranked(['sports', 0.9]),
      }).find((entry) => entry.id === 'sports')!.score,
    ).toBe(0.5)
    expect(
      applyGenericBleed({
        needle: 'bouldering',
        ranked: ranked(['sports', 0.9]),
      }).find((entry) => entry.id === 'sports')!.score,
    ).toBe(0.9)
  })
})

describe('calibrateRankedCategories integration — P1/P3 regressions', () => {
  it('does not auto-apply pain groceries in en-US', async () => {
    // Calibration does not invent a groceries hit for "pain" — it just reorders. The dictionary is the gate.
    // So verify dictionary no longer maps bare "pain" to groceries, and calibration doesn't re-inject it.
    const { suggestCategoryFromTitleForLocale } = await import('../index')
    // en-US has no "pain" alias anymore (moved to fr-FR); shared has no pain.
    const enHit = suggestCategoryFromTitleForLocale('pain', 'en-US', [])
    expect(enHit).toBeNull()
    // If something still ranked groceries for "pain", calibration must not invent it. Test with empty ranked.
    const cal = calibrateRankedCategories({ needle: 'pain', ranked: [] })
    expect(cal.find((entry) => entry.id === 'groceries')).toBeUndefined()
  })

  it('does not route esm to heat-gas globally', () => {
    const out = calibrateRankedCategories({
      needle: 'esm',
      ranked: ranked(['electricity', 0.92], ['heat-gas', 0.3]),
    })
    expect(out.find((entry) => entry.id === 'heat-gas')!.score).toBe(0.3)
  })

  it('does not route taxi/bike/rocket emoji to bus-train', () => {
    const base = ranked(['bus-train', 0.4])
    expect(
      calibrateRankedCategories({ needle: '🚕 munich', ranked: base }),
    ).toEqual(base)
    expect(
      calibrateRankedCategories({ needle: '🚲 munich', ranked: base }),
    ).toEqual(base)
    expect(
      calibrateRankedCategories({ needle: '🚀 prague', ranked: base }),
    ).toEqual(base)
  })

  it('routes real transit emoji plus transit word', () => {
    const out = calibrateRankedCategories({
      needle: '🚄 prague train',
      ranked: ranked(['bus-train', 0.4]),
    })
    expect(out.find((entry) => entry.id === 'bus-train')!.score).toBe(0.96)
  })
})
