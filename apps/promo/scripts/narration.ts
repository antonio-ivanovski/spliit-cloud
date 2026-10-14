import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { selectCampaign } from '../src/catalog'
import { narrationScripts } from '../src/video/narration-scripts'
import type { NarrationScript } from '../src/video/narration-scripts'

export const root = path.resolve(import.meta.dirname, '..')
const models = path.join(root, 'output/tts-models')
const project = path.join(root, 'scripts/tts')
const normalization = 'loudnorm=I=-18:TP=-2:LRA=7'
const runtimeHash = createHash('sha256')
  .update(await readFile(path.join(project, 'uv.lock')))
  .update(await readFile(path.join(project, 'generate.py')))
  .digest('hex')
const assets = [
  {
    name: 'kokoro-v1.0.onnx',
    hash: 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a',
  },
  {
    name: 'voices-v1.0.bin',
    hash: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
  },
]
const narrationDirectory = (id: string) =>
  path.join(root, 'output/media/narration', id)
const scriptHash = (script: NarrationScript) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        engine: 'kokoro-onnx@0.6.1',
        runtimeHash,
        normalization,
        assets,
        voice: script.voice,
        speed: script.speed,
        beats: script.beats.map(({ id, text }) => ({ id, text })),
      }),
    )
    .digest('hex')
function getScript(id: string) {
  const script = narrationScripts[id]
  if (!script) throw new Error(`Unknown narration: ${id}`)
  return script
}
const fileHash = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
export type NarrationManifest = {
  scriptHash: string
  voice: string
  speed: number
  engine: string
  normalization: string
  models: typeof assets
  clips: Array<{
    id: string
    text: string
    file: string
    sha256: string
    duration: number
  }>
}
async function run(args: string[]) {
  const child = Bun.spawn(args, {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      UV_CACHE_DIR: path.join(root, 'output/uv-cache'),
      UV_PYTHON_INSTALL_DIR: path.join(root, 'output/python'),
    },
  })
  const interrupt = () => child.kill('SIGTERM')
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    if ((await child.exited) !== 0) throw new Error(`${args[0]} failed.`)
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
  }
}
class NarrationTimingError extends Error {}

export async function loadNarration(id: string) {
  const script = getScript(id)
  const directory = narrationDirectory(id)
  let manifest: NarrationManifest
  try {
    manifest = JSON.parse(
      await readFile(path.join(directory, 'manifest.json'), 'utf8'),
    )
  } catch {
    throw new Error(
      'Narration is missing. Run bun --filter @spliit/promo narration --campaign <id> first, or export with --silent.',
    )
  }
  if (
    manifest.scriptHash !== scriptHash(script) ||
    manifest.voice !== script.voice ||
    manifest.clips.length !== script.beats.length
  )
    throw new Error(
      'Narration is stale. Run bun --filter @spliit/promo narration --campaign <id> again.',
    )
  for (const [index, beat] of script.beats.entries()) {
    const clip = manifest.clips[index]
    if (
      clip.id !== beat.id ||
      clip.file !== `${beat.id}.wav` ||
      clip.text !== beat.text ||
      !Number.isFinite(clip.duration) ||
      clip.duration <= 0
    )
      throw new Error(`Invalid narration clip: ${beat.id}`)
    if (
      clip.duration +
        (script.leadFrames + script.resultHoldFrames) / script.fps >
      beat.seconds
    )
      throw new NarrationTimingError(
        `Narration for ${beat.id} needs a longer scene (${clip.duration.toFixed(2)}s of speech). Extend the storyboard; do not accelerate speech.`,
      )
    if (
      beat.actionOffsetFrames !== undefined &&
      clip.duration + script.leadFrames / script.fps + 0.5 >
        beat.actionOffsetFrames / script.fps
    ) {
      throw new NarrationTimingError(
        `Narration for ${beat.id} ends too close to its action. Move the action later; do not accelerate speech.`,
      )
    }
    if ((await fileHash(path.join(directory, clip.file))) !== clip.sha256)
      throw new Error(
        `Narration audio changed or is corrupt: ${beat.id}. Regenerate narration.`,
      )
  }
  return manifest
}
async function setup() {
  await mkdir(models, { recursive: true })
  await run(['uv', 'sync', '--locked', '--project', project])
  for (const asset of assets) {
    const file = path.join(models, asset.name)
    if (
      (await Bun.file(file).exists()) &&
      (await fileHash(file)) === asset.hash
    )
      continue
    console.log(`Downloading ${asset.name}…`)
    const pending = `${file}.pending`
    try {
      await run([
        'curl',
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--retry',
        '2',
        '--connect-timeout',
        '15',
        '--max-time',
        '300',
        '--output',
        pending,
        `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/${asset.name}`,
      ])
      if ((await fileHash(pending)) !== asset.hash)
        throw new Error(`Model checksum mismatch: ${asset.name}`)
      await rename(pending, file)
    } finally {
      await rm(pending, { force: true })
    }
  }
  console.log('Local TTS is ready. Inference needs no network or server.')
}
async function generate(id: string, force: boolean) {
  const script = getScript(id)
  const directory = narrationDirectory(id)
  if (!force) {
    try {
      await loadNarration(id)
      console.log('Narration cache is current.')
      return
    } catch (error) {
      if (error instanceof NarrationTimingError) throw error
      // Missing, stale, or corrupt speech needs generation; timing edits do not.
    }
  }
  for (const asset of assets) {
    if (!(await Bun.file(path.join(models, asset.name)).exists()))
      throw new Error('Run bun --filter @spliit/promo narration:setup first.')
    if ((await fileHash(path.join(models, asset.name))) !== asset.hash)
      throw new Error('TTS model checksum mismatch. Run narration:setup.')
  }
  if (!(await Bun.file(path.join(project, '.venv/bin/python')).exists()))
    throw new Error('Run narration:setup to install the locked TTS runtime.')
  await mkdir(path.dirname(directory), { recursive: true })
  const temporary = await mkdtemp(`${directory}-pending-`)
  try {
    const request = {
      model: path.join(models, assets[0].name),
      voices: path.join(models, assets[1].name),
      voice: script.voice,
      speed: script.speed,
      clips: script.beats.map((beat) => ({
        ...beat,
        file: path.join(temporary, `${beat.id}.wav`),
      })),
    }
    const requestFile = path.join(temporary, 'request.json')
    await Bun.write(requestFile, JSON.stringify(request))
    // Execute the prepared interpreter directly: no package/model fetch during inference.
    await run([
      path.join(project, '.venv/bin/python'),
      path.join(project, 'generate.py'),
      requestFile,
    ])
    const clips: NarrationManifest['clips'] = []
    for (const beat of script.beats) {
      const file = `${beat.id}.wav`
      const normalized = path.join(temporary, `${beat.id}-normalized.wav`)
      await run([
        'ffmpeg',
        '-v',
        'error',
        '-i',
        path.join(temporary, file),
        '-af',
        normalization,
        '-ar',
        '24000',
        '-c:a',
        'pcm_s16le',
        normalized,
      ])
      await rename(normalized, path.join(temporary, file))
      const probe = Bun.spawn(
        [
          'ffprobe',
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'csv=p=0',
          path.join(temporary, file),
        ],
        { stdout: 'pipe', stderr: 'inherit' },
      )
      const duration = Number((await new Response(probe.stdout).text()).trim())
      if (
        (await probe.exited) !== 0 ||
        !Number.isFinite(duration) ||
        duration <= 0
      )
        throw new Error(`Invalid audio for ${beat.id}`)
      clips.push({
        id: beat.id,
        text: beat.text,
        file,
        duration,
        sha256: await fileHash(path.join(temporary, file)),
      })
      console.log(
        `${beat.id}: ${duration.toFixed(2)}s speech / ${beat.seconds}s scene`,
      )
    }
    await Bun.write(
      path.join(temporary, 'manifest.json'),
      JSON.stringify(
        {
          scriptHash: scriptHash(script),
          voice: request.voice,
          speed: request.speed,
          engine: 'kokoro-onnx@0.6.1',
          normalization,
          models: assets,
          clips,
        },
        null,
        2,
      ),
    )
    await rm(requestFile)
    await mkdir(directory, { recursive: true })
    for (const clip of clips)
      await rename(
        path.join(temporary, clip.file),
        path.join(directory, clip.file),
      )
    await rename(
      path.join(temporary, 'manifest.json'),
      path.join(directory, 'manifest.json'),
    )
    await loadNarration(id)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        setup: { type: 'boolean' },
        force: { type: 'boolean' },
        campaign: { type: 'string' },
        variant: { type: 'string' },
      },
      allowPositionals: false,
    })
    if (values.setup) await setup()
    else {
      if (!values.campaign)
        throw new Error(
          'Missing --campaign. Use narration:setup for setup, or narration --campaign <id> [--variant <name>].',
        )
      const selection = selectCampaign(values.campaign, values.variant, 'video')
      for (const [, variant] of selection.variants) {
        if (!variant.narration)
          throw new Error('This video has no narration script.')
        await generate(variant.narration, values.force ?? false)
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
