import { receiptAiStoryboard } from '../campaigns/receipt-ai-storyboard'
import { receiptStoryboard } from '../campaigns/receipt-storyboard'

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
  }>
}
/** Plain data shared by local inference and renderer preflight; no UI imports. */
export const narrationScripts: Record<string, NarrationScript> = {
  'receipt-walkthrough': receiptStoryboard,
  'receipt-walkthrough-ai': receiptAiStoryboard,
}
