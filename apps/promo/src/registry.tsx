import type { ComponentType } from 'react'

import { CurrencyPromo } from './campaigns/currency-rework'
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
  'receipt-scan-v2-7-0': { promo: ReceiptPromo },
}
