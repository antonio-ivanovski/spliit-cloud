import { receiptAiStoryboard } from '../campaigns/receipt-ai-storyboard'
import { receiptStoryboard } from '../campaigns/receipt-storyboard'
import { roastStoryboard } from '../campaigns/splitwise-paywall-roast/storyboard'
import { roastShortsStoryboard } from '../campaigns/splitwise-paywall-roast/storyboard-shorts'
import { newImportersStoryboard } from '../campaigns/tricount-settleup-import/storyboard'

export type NarrationScript = {
  compositionId: string
  voice: string
  speed: number
  fps: number
  leadFrames: number
  resultHoldFrames: number
  beats: Array<{
    id: string
    seconds: number
    text: string
    actionOffsetFrames?: number
    resultHoldFrames?: number
    segments?: Array<{ text: string; rate: number }>
  }>
}
/** Plain data shared by local inference and renderer preflight; no UI imports. */
export const narrationScripts: Record<string, NarrationScript> = {
  'splitwise-paywall-roast': roastStoryboard,
  'splitwise-paywall-roast-shorts': roastShortsStoryboard,
  'tricount-settleup-import': newImportersStoryboard,
  'receipt-walkthrough': receiptStoryboard,
  'receipt-walkthrough-ai': receiptAiStoryboard,
}
