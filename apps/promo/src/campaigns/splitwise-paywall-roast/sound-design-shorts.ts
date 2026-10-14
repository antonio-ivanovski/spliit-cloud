import {
  roastShortsBeats,
  roastShortsDuration,
  roastShortsStoryboard,
} from './storyboard-shorts'

/** Shorts cut keeps the same punchy bed, retimed to the vertical timeline. */
export const roastShortsSoundDesign = {
  id: 'splitwise-paywall-roast-shorts',
  narration: roastShortsStoryboard.compositionId,
  fps: roastShortsStoryboard.fps,
  durationInFrames: roastShortsDuration,
  music: {
    model: 'sm-music',
    seed: 5142026,
    seconds: roastShortsDuration / roastShortsStoryboard.fps,
    prompt:
      'Punchy instrumental electronic breakbeat for a witty bright technology product commercial. Tight dry drums, bouncy rounded bass, crisp syncopated synth stabs, playful confident groove, 128 BPM. Immediate rhythmic energy from the first beat, steady groove throughout. No vocals, no singing, no speech, no cinematic build, no distorted guitars.',
  },
  transition: {
    model: 'sm-sfx',
    seed: 5142027,
    seconds: 2,
    prompt:
      'One short crisp punchy airy swoosh with a rounded low impact, clean playful editorial hard cut sound. No voice, no music, no ringing tail.',
  },
  mix: {
    musicDb: -21,
    speechDuckDb: -8,
    effectDb: -19,
    fadeInSeconds: 0.08,
    fadeOutSeconds: 0.6,
    peakCeilingDb: -1.5,
  },
  cues: [
    { kind: 'transition', frame: roastShortsBeats.parody.from },
    { kind: 'transition', frame: roastShortsBeats.reveal.from },
    { kind: 'transition', frame: roastShortsBeats.expenses.from },
    { kind: 'transition', frame: roastShortsBeats.import.from },
    { kind: 'transition', frame: roastShortsBeats.finish.from },
  ],
}
