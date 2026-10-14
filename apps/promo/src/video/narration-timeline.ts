import type { NarrationScript } from './narration-scripts'

/**
 * Shared timing for visuals, separate speech clips, and the offline sound
 * mixer.
 */
export function narrationTimeline(script: NarrationScript) {
  let from = 0
  return script.beats.map((beat) => {
    const durationInFrames = beat.seconds * script.fps
    const entry = { ...beat, from, durationInFrames }
    from += durationInFrames
    return entry
  })
}
