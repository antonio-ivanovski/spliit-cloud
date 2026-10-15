import type { ComponentType } from 'react'

import { CurrencyPromo } from './campaigns/currency-rework'
import { NewImportersPromo } from './campaigns/new-importers-promo'
import { NextHeroPromo } from './campaigns/next-hero'
import { NextSharePromo } from './campaigns/next-share'
import { NextSwapPromo } from './campaigns/next-swap'
import { NextWithdrawnPromo } from './campaigns/next-withdrawn'
import { ReceiptPromo } from './campaigns/receipt-scan'
import type { PromoSize } from './catalog'

/** Add new compositions here and their dimensions in catalog.ts. */
export const compositions: Record<
  string,
  Record<string, ComponentType<PromoSize>>
> = {
  'next-release': {
    swap: NextSwapPromo,
    withdrawn: NextWithdrawnPromo,
    share: NextSharePromo,
    hero: NextHeroPromo,
  },
  'currency-rework': { promo: CurrencyPromo },
  'tricount-settleup-import': { promo: NewImportersPromo },
  'receipt-scan-v2-7-0': { promo: ReceiptPromo },
}
