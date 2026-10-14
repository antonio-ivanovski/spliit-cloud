import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { soundDesignScripts } from '../src/campaigns/receipt-sound-design'
import { selectCampaign } from '../src/catalog'
import { narrationScripts } from '../src/video/narration-scripts'
import { narrationTimeline } from '../src/video/narration-timeline'
import { loadNarration } from './narration'
import models from './sound/models.json'

const root = path.resolve(import.meta.dirname, '..')
const engineRevision = '77e0398c26f7d22d801ec1bb036307e8b231f741'
const engine = path.join(root, 'output/stable-audio-3')
const runtime = path.join(engine, 'optimized/mlx')
const project = path.join(root, 'scripts/sound')
const python = path.join(project, '.venv/bin/python')
const directory = (id: string) =>
  path.join(root, 'output/media/sound-design', id)
const hash = (value: string | Uint8Array) =>
  new Bun.CryptoHasher('sha256').update(value).digest('hex')
const fileHash = async (file: string) =>
  hash(new Uint8Array(await Bun.file(file).arrayBuffer()))

async function run(args: string[]) {
  const child = Bun.spawn(args, {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      UV_CACHE_DIR: path.join(root, 'output/uv-cache'),
      UV_PYTHON_INSTALL_DIR: path.join(root, 'output/python'),
      HF_HOME: path.join(root, 'output/huggingface'),
      HF_HUB_OFFLINE: '1',
      HF_HUB_DISABLE_TELEMETRY: '1',
    },
  })
  const cancel = () => child.kill('SIGTERM')
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  try {
    if ((await child.exited) !== 0) throw new Error(`${args[0]} failed`)
  } finally {
    process.off('SIGINT', cancel)
    process.off('SIGTERM', cancel)
  }
}

function script(id: string) {
  const plan = soundDesignScripts[id as keyof typeof soundDesignScripts]
  if (!plan) throw new Error(`No sound design registered for ${id}`)
  return plan
}
async function identity(id: string) {
  const plan = script(id)
  const narration = await loadNarration(plan.narration)
  const speechScript = narrationScripts[plan.narration]
  const beats = narrationTimeline(speechScript)
  if (
    speechScript.fps !== plan.fps ||
    beats.reduce((sum, beat) => sum + beat.durationInFrames, 0) !==
      plan.durationInFrames
  )
    throw new Error('Sound design and narration timelines disagree.')
  const fingerprint = hash(
    JSON.stringify({
      plan,
      narration,
      timeline: {
        beats,
        leadFrames: speechScript.leadFrames,
        resultHoldFrames: speechScript.resultHoldFrames,
      },
      models,
      engineRevision,
      runtimeLock: await fileHash(path.join(project, 'uv.lock')),
      mixer: await fileHash(path.join(project, 'mix.py')),
    }),
  )
  return { plan, narration, fingerprint, speechScript, beats }
}
/**
 * Validate the exact local mix before bundling; stale audio must never replace
 * current speech.
 */
export async function loadSoundDesign(id: string) {
  const { fingerprint, plan } = await identity(id)
  const file = Bun.file(path.join(directory(id), 'manifest.json'))
  if (!(await file.exists()))
    throw new Error(
      `Missing sound design. Run bun --filter @spliit/promo sound-design --campaign receipt-scan-v2-7-0, or export with --no-sound-design.`,
    )
  const manifest = (await file.json()) as {
    fingerprint: string
    files: Record<string, string>
    duration: number
  }
  if (
    manifest.fingerprint !== fingerprint ||
    manifest.duration !== plan.durationInFrames / plan.fps
  )
    throw new Error('Stale sound design; regenerate it before exporting.')
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (
      ![
        'mix.wav',
        'background.wav',
        'music.wav',
        'transition.wav',
        'transition-source.wav',
        'tap.wav',
        'chime.wav',
      ].includes(name) ||
      (await fileHash(path.join(directory(id), name))) !== digest
    )
      throw new Error(`Modified sound-design asset: ${name}`)
  }
  if (!manifest.files['mix.wav']) throw new Error('Missing mixed soundtrack')
  return manifest
}
async function setup() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error(
      'This prepared Stable Audio runtime uses Apple Silicon MLX. Use the official CPU runtime on other platforms.',
    )
  await mkdir(path.join(root, 'output'), { recursive: true })
  if (!(await Bun.file(path.join(engine, 'README.md')).exists()))
    await run([
      'git',
      'clone',
      'https://github.com/Stability-AI/stable-audio-3.git',
      engine,
    ])
  await run(['git', '-C', engine, 'checkout', '--detach', engineRevision])
  await run(['uv', 'sync', '--locked', '--project', project])
  const weightDirectory = path.join(runtime, 'models/mlx')
  await mkdir(weightDirectory, { recursive: true })
  for (const model of models.files) {
    const target = path.join(weightDirectory, model.name)
    if (
      (await Bun.file(target).exists()) &&
      (await fileHash(target)) === model.sha256
    )
      continue
    console.log(`Downloading ${model.name}…`)
    const pending = `${target}.pending`
    try {
      await run([
        'curl',
        '-fL',
        '--silent',
        '--show-error',
        '--retry',
        '2',
        '--connect-timeout',
        '15',
        '--max-time',
        '600',
        '-o',
        pending,
        `https://huggingface.co/${models.repository}/resolve/${models.revision}/MLX/${model.name}`,
      ])
      if ((await fileHash(pending)) !== model.sha256)
        throw new Error(`Model checksum mismatch: ${model.name}`)
      await rename(pending, target)
    } finally {
      await rm(pending, { force: true })
    }
  }
  console.log(
    'Stable Audio 3 Small-Music and Small-SFX are ready for offline inference.',
  )
}
async function generate(id: string, force: boolean) {
  const { plan, narration, fingerprint, speechScript, beats } =
    await identity(id)
  if (!force) {
    try {
      await loadSoundDesign(id)
      console.log('Sound design is current.')
      return
    } catch {
      /* Generate an absent or stale cache. */
    }
  }
  if (!(await Bun.file(python).exists()))
    throw new Error('Run sound-design:setup first.')
  for (const model of models.files)
    if (
      (await fileHash(path.join(runtime, 'models/mlx', model.name))) !==
      model.sha256
    )
      throw new Error(
        `Run sound-design:setup: missing or modified ${model.name}`,
      )
  const parent = path.dirname(directory(id))
  await mkdir(parent, { recursive: true })
  const pending = await mkdtemp(path.join(parent, `${id}-pending-`))
  try {
    let previous:
      | {
          plan: typeof plan
          engineRevision: string
          models: typeof models
          files: Record<string, string>
        }
      | undefined
    try {
      previous = await Bun.file(
        path.join(directory(id), 'manifest.json'),
      ).json()
    } catch {
      /* A missing or damaged cache can be regenerated. */
    }
    for (const [name, config] of [
      ['music', plan.music],
      ['transition', plan.transition],
    ] as const) {
      const filename =
        name === 'transition' ? 'transition-source.wav' : 'music.wav'
      const source = path.join(directory(id), filename)
      if (
        !force &&
        previous?.engineRevision === engineRevision &&
        JSON.stringify(previous.models) === JSON.stringify(models) &&
        JSON.stringify(previous.plan[name]) === JSON.stringify(config) &&
        previous.files[filename] &&
        (await Bun.file(source).exists()) &&
        (await fileHash(source)) === previous.files[filename]
      ) {
        await cp(source, path.join(pending, filename))
        console.log(`Reusing selected ${name}.`)
        continue
      }
      console.log(`Generating ${name} locally…`)
      await run([
        python,
        path.join(runtime, 'scripts/sa3_mlx.py'),
        '--dit',
        config.model,
        '--decoder',
        'same-s',
        '--seconds',
        String(config.seconds),
        '--seed',
        String(config.seed),
        '--steps',
        '8',
        '--prompt',
        config.prompt,
        '--out',
        path.join(pending, filename),
      ])
    }
    const request = path.join(pending, 'request.json')
    await Bun.write(
      request,
      JSON.stringify({
        plan,
        narration,
        directory: pending,
        voiceDirectory: path.join(
          root,
          'output/media/narration',
          plan.narration,
        ),
        beats,
        leadFrames: speechScript.leadFrames,
        resultHoldFrames: speechScript.resultHoldFrames,
      }),
    )
    await run([python, path.join(project, 'mix.py'), request])
    await rm(request)
    const files: Record<string, string> = {}
    for (const name of [
      'mix.wav',
      'background.wav',
      'music.wav',
      'transition.wav',
      'transition-source.wav',
      'tap.wav',
      'chime.wav',
    ])
      files[name] = await fileHash(path.join(pending, name))
    await Bun.write(
      path.join(pending, 'manifest.json'),
      JSON.stringify(
        {
          fingerprint,
          duration: plan.durationInFrames / plan.fps,
          plan,
          engineRevision,
          models,
          files,
        },
        null,
        2,
      ),
    )
    await mkdir(directory(id), { recursive: true })
    for (const name of [...Object.keys(files), 'manifest.json'])
      await rename(path.join(pending, name), path.join(directory(id), name))
    await loadSoundDesign(id)
    console.log(`Sound design ready: ${directory(id)}/mix.wav`)
  } finally {
    await rm(pending, { recursive: true, force: true })
  }
}
async function main() {
  const { values } = parseArgs({
    options: {
      setup: { type: 'boolean' },
      force: { type: 'boolean' },
      campaign: { type: 'string' },
      variant: { type: 'string' },
    },
    strict: true,
  })
  if (values.setup) {
    await setup()
    return
  }
  if (!values.campaign) throw new Error('Provide --campaign or --setup.')
  const { variants } = selectCampaign(values.campaign, values.variant, 'video')
  for (const [, variant] of variants) {
    if (variant.kind !== 'video' || !variant.soundDesign)
      throw new Error('Selected variant has no sound design.')
    await generate(variant.soundDesign, Boolean(values.force))
  }
}
if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
