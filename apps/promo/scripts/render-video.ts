import { mkdir, mkdtemp, rm, rename } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { bundle } from '@remotion/bundler'
import {
  makeCancelSignal,
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
} from '@remotion/renderer'

import { overrideBundler } from '../remotion-bundler'
import type { VideoVariant } from '../src/catalog'
import { selectCampaign } from '../src/catalog'
import { loadNarration } from './narration'
import { loadSoundDesign } from './sound-design'

const root = path.resolve(import.meta.dirname, '..')

/** Export CLI contract: validate before bundling or launching Chromium. */
export function parseVideoArgs(args: string[]) {
  const [mode, ...options] = args
  if (mode !== 'video' && mode !== 'poster')
    throw new Error('Expected video or poster mode.')
  const { values } = parseArgs({
    args: options,
    options: {
      campaign: { type: 'string' },
      variant: { type: 'string' },
      out: { type: 'string' },
      ...(mode === 'poster' ? { frame: { type: 'string' as const } } : {}),
      help: { type: 'boolean' },
      ...(mode === 'video'
        ? {
            silent: { type: 'boolean' as const },
            'no-sound-design': { type: 'boolean' as const },
          }
        : {}),
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.help) return { mode, help: true as const }
  if (!values.campaign)
    throw new Error('Missing --campaign. Use --help for usage.')
  const selection = selectCampaign(values.campaign, values.variant, 'video')
  const frameText = 'frame' in values ? values.frame : undefined
  const frame = frameText === undefined ? undefined : Number(frameText)
  if (
    frameText !== undefined &&
    (typeof frameText !== 'string' ||
      !/^\d+$/.test(frameText) ||
      !Number.isSafeInteger(frame))
  ) {
    throw new Error('--frame must be a non-negative integer.')
  }
  for (const [, variant] of selection.variants) {
    validateVideo(variant, frame)
  }
  return {
    mode,
    help: false as const,
    ...selection,
    silent: 'silent' in values && values.silent === true,
    noSoundDesign:
      'no-sound-design' in values && values['no-sound-design'] === true,
    frame,
    output: values.out ? path.resolve(values.out) : path.join(root, 'output'),
  }
}

function validateVideo(variant: VideoVariant, frame?: number) {
  if (
    ![
      variant.width,
      variant.height,
      variant.fps,
      variant.durationInFrames,
    ].every((value) => Number.isSafeInteger(value) && value > 0)
  )
    throw new Error(
      'Video dimensions, fps, and duration must be positive integers.',
    )
  if (variant.width % 2 || variant.height % 2)
    throw new Error('H.264 dimensions must be even.')
  const selectedFrame = frame ?? variant.posterFrame
  if (
    !Number.isSafeInteger(selectedFrame) ||
    selectedFrame < 0 ||
    selectedFrame >= variant.durationInFrames
  ) {
    throw new Error(
      `Poster frame must be between 0 and ${variant.durationInFrames - 1}.`,
    )
  }
}

async function render() {
  const options = parseVideoArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      `Usage: bun --filter @spliit/promo render:${options.mode} --campaign <id> [--variant <name>] [--out <directory>]${options.mode === 'poster' ? ' [--frame <zero-based frame>]' : ' [--silent] [--no-sound-design]'}\nOmit --variant to export all video variants. --out resolves from the working directory.`,
    )
    return
  }
  for (const [, variant] of options.variants) {
    if (options.mode === 'video' && !options.silent && variant.narration) {
      await loadNarration(variant.narration)
      if (variant.soundDesign && !options.noSoundDesign)
        await loadSoundDesign(variant.soundDesign)
    }
  }
  await mkdir(path.join(root, 'output/media'), { recursive: true })
  await mkdir(options.output, { recursive: true })
  const temporary = await mkdtemp(path.join(options.output, '.remotion-'))
  const { cancel, cancelSignal } = makeCancelSignal()
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined
  let interrupted = false
  const interrupt = () => {
    interrupted = true
    process.exitCode = 130
    cancel()
  }
  const terminate = () => {
    interrupted = true
    process.exitCode = 143
    cancel()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    console.log('Bundling local promo assets…')
    const serveUrl = await bundle({
      entryPoint: path.join(root, 'src/video/index.tsx'),
      outDir: path.join(temporary, 'bundle'),
      rootDir: root,
      publicDir: path.join(root, 'output/media'),
      enableCaching: false,
      bundlerOverride: overrideBundler,
    })
    if (interrupted) return
    browser = await openBrowser('chrome')
    if (interrupted) return
    for (const [name, variant] of options.variants) {
      if (interrupted) break
      const audioEnabled =
        options.mode === 'video' &&
        !options.silent &&
        Boolean(variant.narration)
      const soundDesignEnabled =
        audioEnabled && !options.noSoundDesign && Boolean(variant.soundDesign)
      const inputProps = { audioEnabled, soundDesignEnabled }
      const composition = await selectComposition({
        serveUrl,
        id: variant.compositionId,
        inputProps,
        puppeteerInstance: browser,
      })
      if (
        composition.width !== variant.width ||
        composition.height !== variant.height ||
        composition.fps !== variant.fps ||
        composition.durationInFrames !== variant.durationInFrames
      )
        throw new Error(
          `Composition metadata differs from catalog: ${variant.compositionId}`,
        )
      const extension = options.mode === 'video' ? 'mp4' : 'png'
      const filename = `${options.campaign.id}-${name}${options.mode === 'poster' ? '-poster' : ''}.${extension}`
      const pending = path.join(temporary, filename)
      const outputLocation = path.join(options.output, filename)
      const onBrowserLog = (log: { type: string; text: string }) => {
        if (log.type === 'error') {
          console.error(log.text)
          cancel()
        }
      }
      if (options.mode === 'video') {
        let lastProgress = -1
        await renderMedia({
          serveUrl,
          composition,
          inputProps,
          outputLocation: pending,
          puppeteerInstance: browser,
          cancelSignal,
          onBrowserLog,
          codec: 'h264',
          pixelFormat: 'yuv420p',
          crf: 18,
          imageFormat: 'png',
          muted: !audioEnabled,
          ...(audioEnabled
            ? { audioCodec: 'aac' as const, audioBitrate: '192k' }
            : {}),
          concurrency: 2,
          onProgress: ({ progress }) => {
            const percent = Math.floor(progress * 10) * 10
            if (percent !== lastProgress) {
              console.log(`${name}: ${percent}%`)
              lastProgress = percent
            }
          },
        })
      } else {
        await renderStill({
          serveUrl,
          composition,
          inputProps,
          output: pending,
          puppeteerInstance: browser,
          cancelSignal,
          onBrowserLog,
          imageFormat: 'png',
          frame: options.frame ?? variant.posterFrame,
        })
      }
      if (interrupted) break
      await rename(pending, outputLocation)
      console.log(
        `Exported ${variant.width}×${variant.height}${options.mode === 'video' ? ` · ${variant.durationInFrames / variant.fps}s at ${variant.fps}fps` : ''}: ${outputLocation}`,
      )
    }
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
    try {
      await browser?.close({ silent: true })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
}

if (import.meta.main) {
  try {
    await render()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode ||= 1
  }
  // Remotion documents that Bun can retain renderer handles after completion.
  // All owned resources have been closed in finally before terminating the CLI.
  process.exit(process.exitCode ?? 0)
}
