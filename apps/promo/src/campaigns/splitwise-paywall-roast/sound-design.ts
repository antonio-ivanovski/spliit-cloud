import { roastBeats, roastDuration, roastStoryboard } from './storyboard'

/** Original local instrumental; effects accent editorial cuts, not app actions. */
export const roastSoundDesign = {
  id: 'splitwise-paywall-roast',
  narration: roastStoryboard.compositionId,
  fps: roastStoryboard.fps,
  durationInFrames: roastDuration,
  music: {
    model: 'sm-music',
    seed: 5142026,
    seconds: roastDuration / roastStoryboard.fps,
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
    { kind: 'transition', frame: roastBeats.parody.from },
    { kind: 'transition', frame: roastBeats.reveal.from },
    { kind: 'tap', frame: roastBeats.stop.from },
  ],
}
