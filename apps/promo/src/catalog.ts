import {
  receiptAiDuration,
  receiptAiBeats,
} from './campaigns/receipt-ai-storyboard'
import { receiptDuration } from './campaigns/receipt-storyboard'
import { roastDuration } from './campaigns/splitwise-paywall-roast/storyboard'
import { roastShortsDuration } from './campaigns/splitwise-paywall-roast/storyboard-shorts'

export type PromoSize = { width: number; height: number }
export type StaticVariant = PromoSize & { kind: 'static' }
export type VideoVariant = PromoSize & {
  kind: 'video'
  fps: number
  durationInFrames: number
  compositionId: string
  posterFrame: number
  narration?: string
  soundDesign?: string
}
export type PromoVariant = StaticVariant | VideoVariant
export type Campaign = {
  id: string
  title: string
  variants: Record<string, PromoVariant>
}

/** Shared by the browser and CLI. Keep this module free of browser imports. */
export const campaigns: Campaign[] = [
  {
    id: 'splitwise-paywall-roast',
    title: 'Counting to Five Is Premium',
    variants: {
      landscape: {
        kind: 'video',
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: roastDuration,
        compositionId: 'splitwise-paywall-roast',
        posterFrame: 150,
        narration: 'splitwise-paywall-roast',
        soundDesign: 'splitwise-paywall-roast',
      },
      shorts: {
        kind: 'video',
        width: 1080,
        height: 1920,
        fps: 30,
        durationInFrames: roastShortsDuration,
        compositionId: 'splitwise-paywall-roast-shorts',
        posterFrame: roastShortsDuration - 60,
        narration: 'splitwise-paywall-roast-shorts',
        soundDesign: 'splitwise-paywall-roast-shorts',
      },
    },
  },
  {
    id: 'next-release',
    title: 'Next release',
    variants: {
      swap: { kind: 'static', width: 1600, height: 900 },
      withdrawn: { kind: 'static', width: 1600, height: 900 },
      share: { kind: 'static', width: 1600, height: 900 },
      hero: { kind: 'static', width: 1600, height: 900 },
    },
  },
  {
    id: 'currency-rework',
    title: 'Currency rework',
    variants: { promo: { kind: 'static', width: 1600, height: 900 } },
  },
  {
    id: 'receipt-scan-v2-7-0',
    title: 'Receipt scanning · v2.7.0',
    variants: {
      promo: { kind: 'static', width: 1600, height: 900 },
      walkthrough: {
        kind: 'video',
        width: 1600,
        height: 900,
        fps: 30,
        durationInFrames: receiptDuration,
        compositionId: 'receipt-walkthrough',
        posterFrame: receiptDuration - 90,
        narration: 'receipt-walkthrough',
        soundDesign: 'receipt-walkthrough',
      },
      'walkthrough-ai': {
        kind: 'video',
        width: 1600,
        height: 900,
        fps: 30,
        durationInFrames: receiptAiDuration,
        compositionId: 'receipt-walkthrough-ai',
        posterFrame:
          receiptAiBeats.result.from +
          receiptAiBeats.result.durationInFrames -
          90,
        narration: 'receipt-walkthrough-ai',
        soundDesign: 'receipt-walkthrough-ai',
      },
    },
  },
]

type Selection<T extends PromoVariant> = {
  campaign: Campaign
  variants: Array<[string, T]>
}

export function selectCampaign(
  id: string,
  variant?: string,
  kind?: 'static',
): Selection<StaticVariant>
export function selectCampaign(
  id: string,
  variant: string | undefined,
  kind: 'video',
): Selection<VideoVariant>
export function selectCampaign(
  id: string,
  variant?: string,
  kind: PromoVariant['kind'] = 'static',
): Selection<PromoVariant> {
  const campaign = campaigns.find((entry) => entry.id === id)
  if (!campaign) {
    throw new Error(
      `Unknown campaign "${id}". Available: ${campaigns.map((entry) => entry.id).join(', ')}`,
    )
  }
  if (variant !== undefined && !Object.hasOwn(campaign.variants, variant)) {
    throw new Error(
      `Unknown variant "${variant}". Available: ${Object.keys(campaign.variants).join(', ')}`,
    )
  }
  const entries = Object.entries(campaign.variants)
  if (variant !== undefined && campaign.variants[variant].kind !== kind) {
    throw new Error(
      `Variant "${variant}" is ${campaign.variants[variant].kind}; use the ${campaign.variants[variant].kind === 'video' ? 'render:video or render:poster' : 'render'} command.`,
    )
  }
  const variants = entries.filter(
    ([name, entry]) =>
      entry.kind === kind && (variant === undefined || name === variant),
  )
  if (!variants.length) throw new Error(`No ${kind} variants for "${id}".`)
  return { campaign, variants }
}
