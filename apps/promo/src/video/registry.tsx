import type { ComponentType } from 'react'

import { ReceiptWalkthrough } from '../campaigns/receipt-walkthrough'
import { ReceiptWalkthroughAi } from '../campaigns/receipt-walkthrough-ai'
import { SplitwisePaywallRoast } from '../campaigns/splitwise-paywall-roast/video'
import { SplitwisePaywallRoastShorts } from '../campaigns/splitwise-paywall-roast/video-shorts'

export const videoCompositions: Record<
  string,
  ComponentType<{ audioEnabled?: boolean; soundDesignEnabled?: boolean }>
> = {
  'splitwise-paywall-roast': SplitwisePaywallRoast,
  'splitwise-paywall-roast-shorts': SplitwisePaywallRoastShorts,
  'receipt-walkthrough': ReceiptWalkthrough,
  'receipt-walkthrough-ai': ReceiptWalkthroughAi,
}
