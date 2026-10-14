import type { ComponentType } from 'react'

import { ReceiptWalkthrough } from '../campaigns/receipt-walkthrough'
import { ReceiptWalkthroughAi } from '../campaigns/receipt-walkthrough-ai'

export const videoCompositions: Record<
  string,
  ComponentType<{ audioEnabled?: boolean; soundDesignEnabled?: boolean }>
> = {
  'receipt-walkthrough': ReceiptWalkthrough,
  'receipt-walkthrough-ai': ReceiptWalkthroughAi,
}
