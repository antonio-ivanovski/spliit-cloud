import { expect, test } from 'bun:test'
import path from 'node:path'

import { featureTiming } from '../src/campaigns/splitwise-paywall-roast/feature-timing'
import { narrationScripts } from '../src/video/narration-scripts'
import { loadNarration } from './narration'

const root = path.resolve(import.meta.dirname, '..')
async function samples(file: string) {
  const child = Bun.spawn(
    [
      'ffmpeg',
      '-v',
      'error',
      '-i',
      file,
      '-ar',
      '44100',
      '-ac',
      '1',
      '-f',
      'f32le',
      '-',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const bytes = await new Response(child.stdout).arrayBuffer()
  const error = await new Response(child.stderr).text()
  if ((await child.exited) !== 0) throw new Error(error)
  return new Float32Array(bytes)
}

// Tests the actual mixed audio, rather than assuming a validated clip was placed correctly.
test('the AI mix places every narration clip in its own scene with quiet speech gaps', async () => {
  const id = 'receipt-walkthrough-ai'
  const script = narrationScripts[id]
  const mix = await samples(
    path.join(root, `output/media/sound-design/${id}/mix.wav`),
  )
  const background = await samples(
    path.join(root, `output/media/sound-design/${id}/background.wav`),
  )
  let sceneStart = 0
  for (const beat of script.beats) {
    const clip = await samples(
      path.join(root, `output/media/narration/${id}/${beat.id}.wav`),
    )
    const start = Math.round(
      (sceneStart + script.leadFrames / script.fps) * 44100,
    )
    let dot = 0,
      sourceEnergy = 0,
      mixEnergy = 0
    for (let i = 0; i < clip.length; i++) {
      dot += clip[i] * mix[start + i]
      sourceEnergy += clip[i] ** 2
      mixEnergy += mix[start + i] ** 2
    }
    const correlation = dot / Math.sqrt(sourceEnergy * mixEnergy)
    expect(
      correlation,
      `${beat.id} narration is placed at the wrong time`,
    ).toBeGreaterThan(0.98)
    const gain = dot / sourceEnergy
    const end = Math.round((sceneStart + beat.seconds) * 44100)
    let residualEnergy = 0
    // The mixer scales speech and background together when applying its peak ceiling.
    for (let i = start + clip.length; i < end; i++)
      residualEnergy += (mix[i] - gain * background[i]) ** 2
    const gapRms = Math.sqrt(residualEnergy / (end - start - clip.length))
    expect(
      gapRms,
      `${beat.id} speech continues into the reading hold`,
    ).toBeLessThan(0.001)
    sceneStart += beat.seconds
  }
}, 30000)

// Protects against high-rate tempo filters silently dropping late speech and
// against rendering with timings from a different generated avalanche clip.
test('accelerating narration retains every feature and shares its visual clock', async () => {
  const manifest = await loadNarration('splitwise-paywall-roast')
  const clip = manifest.clips.find((entry) => entry.id === 'avalanche')!
  expect(clip.segments).toEqual(featureTiming)
  const audio = await samples(
    path.join(
      root,
      'output/media/narration/splitwise-paywall-roast/avalanche.wav',
    ),
  )
  for (const segment of clip.segments!) {
    const start = Math.round((segment.startFrame / 30) * 44100)
    const end = Math.round((segment.endFrame / 30) * 44100)
    let energy = 0
    for (let i = start; i < end; i++) energy += audio[i] ** 2
    expect(
      Math.sqrt(energy / (end - start)),
      `${segment.text} vanished during acceleration`,
    ).toBeGreaterThan(0.001)
  }
  expect(
    Math.abs(audio.length / 44100 - featureTiming.at(-1)!.endFrame / 30),
  ).toBeLessThan(1 / 30)
}, 30000)
