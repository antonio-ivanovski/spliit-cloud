import {
  newImportersBeats,
  newImportersDuration,
  newImportersStoryboard,
} from './storyboard'

/** Original local instrumental; effects accent editorial cuts, not app actions. */
export const newImportersSoundDesign = {
  id: 'tricount-settleup-import',
  narration: newImportersStoryboard.compositionId,
  fps: newImportersStoryboard.fps,
  durationInFrames: newImportersDuration,
  music: {
    model: 'sm-music',
    seed: 10152026,
    seconds: newImportersDuration / newImportersStoryboard.fps,
    prompt:
      'Punchy instrumental electronic breakbeat for a witty bright technology product commercial. Tight dry drums, bouncy rounded bass, crisp syncopated synth stabs, playful confident groove, 128 BPM. Immediate rhythmic energy from the first beat, steady groove throughout. No vocals, no singing, no speech, no cinematic build, no distorted guitars.',
  },
  transition: {
    model: 'sm-sfx',
    seed: 10152027,
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
    { kind: 'transition', frame: newImportersBeats.roast.from },
    { kind: 'tap', frame: newImportersBeats.escape.from },
    { kind: 'tap', frame: newImportersBeats.family.from },
  ],
}
