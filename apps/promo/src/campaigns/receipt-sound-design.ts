import {
  receiptAiActions,
  receiptAiBeats,
  receiptAiDuration,
} from './receipt-ai-storyboard'
import {
  receiptActionFrames,
  receiptDuration,
  receiptStoryboard,
  receiptTimeline,
} from './receipt-storyboard'
import { roastSoundDesign } from './splitwise-paywall-roast/sound-design'
import { roastShortsSoundDesign } from './splitwise-paywall-roast/sound-design-shorts'

/** Sound follows the existing visual actions; never retime a scene for music. */
export const receiptSoundDesign = {
  id: 'receipt-walkthrough',
  narration: receiptStoryboard.compositionId,
  fps: receiptStoryboard.fps,
  durationInFrames: receiptDuration,
  music: {
    model: 'sm-music',
    seed: 2050,
    seconds: receiptDuration / receiptStoryboard.fps,
    prompt:
      'Quiet warm minimal instrumental background for a friendly app tutorial. Soft electric piano chords, mellow rounded synth pad, sparse light pulse, 82 BPM. Calm, reassuring, understated. No vocals, no singing, no dramatic build, no heavy drums.',
  },
  transition: {
    model: 'sm-sfx',
    seed: 2051,
    seconds: 2,
    prompt:
      'A single gentle short airy soft whoosh, smooth rounded texture, quiet clean transition sound for a friendly interface. No voice, no music, no harsh impact.',
  },
  mix: {
    musicDb: -32,
    speechDuckDb: -8,
    effectDb: -27,
    fadeInSeconds: 2,
    fadeOutSeconds: 3,
    peakCeilingDb: -1.5,
  },
  cues: [
    { kind: 'tap', frame: receiptActionFrames.upload },
    { kind: 'transition', frame: receiptTimeline[2].from },
    { kind: 'tap', frame: receiptActionFrames.itemized },
    { kind: 'tap', frame: receiptActionFrames.selectJamie },
    { kind: 'tap', frame: receiptActionFrames.saveCoffee },
    { kind: 'chime', frame: receiptActionFrames.saved + 6 },
  ],
}
export const receiptAiSoundDesign = {
  ...receiptSoundDesign,
  id: 'receipt-walkthrough-ai',
  narration: 'receipt-walkthrough-ai',
  durationInFrames: receiptAiDuration,
  music: {
    ...receiptSoundDesign.music,
    seconds: receiptAiDuration / receiptSoundDesign.fps,
  },
  cues: [
    { kind: 'tap', frame: receiptAiActions.upload },
    { kind: 'transition', frame: receiptAiBeats.review.from },
    { kind: 'tap', frame: receiptAiActions.openCoffee },
    { kind: 'tap', frame: receiptAiActions.selectJamie },
    { kind: 'tap', frame: receiptAiActions.saveCoffee },
    { kind: 'chime', frame: receiptAiActions.saved + 6 },
  ],
}
export const soundDesignScripts = {
  'splitwise-paywall-roast': roastSoundDesign,
  'splitwise-paywall-roast-shorts': roastShortsSoundDesign,
  'receipt-walkthrough': receiptSoundDesign,
  'receipt-walkthrough-ai': receiptAiSoundDesign,
}
