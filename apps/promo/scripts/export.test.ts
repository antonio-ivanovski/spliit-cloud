import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
async function invoke(args: string[], cwd = root) {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}
async function command(args: string[], cwd = root) {
  const result = await invoke(args, cwd)
  if (result.exitCode !== 0)
    throw new Error(
      `${args.join(' ')} failed (${result.exitCode})\n${result.stdout}\n${result.stderr}`,
    )
  return result.stdout
}
async function metadata(video: string) {
  return JSON.parse(
    await command([
      'ffprobe',
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      video,
    ]),
  ) as {
    streams: Array<{
      codec_type: string
      codec_name: string
      width: number
      height: number
      r_frame_rate: string
      pix_fmt: string
    }>
    format: { duration: string }
  }
}
// Real CLI boundary, in an isolated package: never mutate the author's audio cache.
// Prepare narration once before this opt-in test. No running app, API, or DB.
test('exports sound-designed video/poster, rejects unusable narration, and supports silent export without speech', async () => {
  await mkdir(path.join(root, 'output'), { recursive: true })
  const directory = await mkdtemp(path.join(root, 'output/export-test-'))
  const isolated = path.join(directory, 'promo')
  try {
    await mkdir(path.join(isolated, 'scripts/tts'), { recursive: true })
    for (const name of [
      'src',
      'remotion-bundler.ts',
      'package.json',
      'tsconfig.json',
    ])
      await cp(path.join(root, name), path.join(isolated, name), {
        recursive: true,
      })
    for (const name of ['render-video.ts', 'narration.ts', 'sound-design.ts'])
      await cp(
        path.join(root, 'scripts', name),
        path.join(isolated, 'scripts', name),
      )
    await cp(
      path.join(root, 'scripts/sound'),
      path.join(isolated, 'scripts/sound'),
      { recursive: true, filter: (source) => !source.includes('/.venv') },
    )
    for (const name of ['uv.lock', 'generate.py'])
      await cp(
        path.join(root, 'scripts/tts', name),
        path.join(isolated, 'scripts/tts', name),
      )
    await symlink(
      path.join(root, 'node_modules'),
      path.join(isolated, 'node_modules'),
      'dir',
    )
    await symlink(
      path.resolve(root, '../web'),
      path.join(directory, 'web'),
      'dir',
    )
    const selection = [
      '--campaign',
      'receipt-scan-v2-7-0',
      '--variant',
      'walkthrough',
      '--out',
      path.join(directory, 'rendered'),
    ]
    const videoArgs = ['bun', 'scripts/render-video.ts', 'video', ...selection]
    const missing = await invoke(videoArgs, isolated)
    expect(missing.exitCode).toBe(1)
    expect(missing.stderr).toContain('Narration is missing')
    await cp(
      path.join(root, 'output/media'),
      path.join(isolated, 'output/media'),
      { recursive: true },
    )
    const speech = path.join(
      isolated,
      'output/media/narration/receipt-walkthrough',
    )
    const manifestFile = path.join(speech, 'manifest.json')
    const original = await Bun.file(manifestFile).text()
    const manifest = JSON.parse(original)
    await Bun.write(
      manifestFile,
      JSON.stringify({ ...manifest, scriptHash: 'stale' }),
    )
    const stale = await invoke(videoArgs, isolated)
    expect(stale.exitCode).toBe(1)
    expect(stale.stderr).toContain('Narration is stale')
    manifest.clips[0].duration = 100
    await Bun.write(manifestFile, JSON.stringify(manifest))
    const overlong = await invoke(videoArgs, isolated)
    expect(overlong.exitCode).toBe(1)
    expect(overlong.stderr).toContain('needs a longer scene')
    await Bun.write(manifestFile, original)
    const clip = path.join(speech, 'upload.wav')
    await Bun.write(clip, 'corrupt audio')
    const corrupt = await invoke(videoArgs, isolated)
    expect(corrupt.exitCode).toBe(1)
    expect(corrupt.stderr).toContain('changed or is corrupt')
    await cp(
      path.join(root, 'output/media/narration/receipt-walkthrough/upload.wav'),
      clip,
    )
    const soundDirectory = path.join(
      isolated,
      'output/media/sound-design/receipt-walkthrough',
    )
    const soundManifestFile = path.join(soundDirectory, 'manifest.json')
    const soundOriginal = await Bun.file(soundManifestFile).text()
    await rm(soundManifestFile)
    const missingSound = await invoke(videoArgs, isolated)
    expect(missingSound.exitCode).toBe(1)
    expect(missingSound.stderr).toContain('Missing sound design')
    await Bun.write(
      soundManifestFile,
      JSON.stringify({ ...JSON.parse(soundOriginal), fingerprint: 'stale' }),
    )
    const staleSound = await invoke(videoArgs, isolated)
    expect(staleSound.exitCode).toBe(1)
    expect(staleSound.stderr).toContain('Stale sound design')
    await Bun.write(soundManifestFile, soundOriginal)
    await Bun.write(path.join(soundDirectory, 'mix.wav'), 'corrupt mix')
    const corruptSound = await invoke(videoArgs, isolated)
    expect(corruptSound.exitCode).toBe(1)
    expect(corruptSound.stderr).toContain('Modified sound-design asset')
    await cp(
      path.join(root, 'output/media/sound-design/receipt-walkthrough/mix.wav'),
      path.join(soundDirectory, 'mix.wav'),
    )
    await command(
      ['bun', 'scripts/render-video.ts', 'poster', ...selection],
      isolated,
    )
    const bytes = new DataView(
      await Bun.file(
        path.join(
          directory,
          'rendered/receipt-scan-v2-7-0-walkthrough-poster.png',
        ),
      ).arrayBuffer(),
    )
    expect(bytes.getUint32(0)).toBe(0x89504e47)
    expect([bytes.getUint32(16), bytes.getUint32(20)]).toEqual([1600, 900])
    await command(videoArgs, isolated)
    const video = path.join(
      directory,
      'rendered/receipt-scan-v2-7-0-walkthrough.mp4',
    )
    const narrated = await metadata(video)
    expect(narrated.streams).toHaveLength(2)
    expect(
      narrated.streams.find((stream) => stream.codec_type === 'video'),
    ).toMatchObject({
      codec_name: 'h264',
      width: 1600,
      height: 900,
      r_frame_rate: '30/1',
      pix_fmt: 'yuv420p',
    })
    expect(
      narrated.streams.find((stream) => stream.codec_type === 'audio'),
    ).toMatchObject({ codec_name: 'aac' })
    expect(Number(narrated.format.duration)).toBeCloseTo(58, 1)
    await command(['ffmpeg', '-v', 'error', '-i', video, '-f', 'null', '-'])
    const pcm = Bun.spawn(
      ['ffmpeg', '-v', 'error', '-i', video, '-vn', '-f', 's16le', '-'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const samples = new Uint8Array(await new Response(pcm.stdout).arrayBuffer())
    expect(await pcm.exited).toBe(0)
    expect(samples.some((byte) => byte !== 0)).toBe(true)
    // Nicole finishes the opening sentence before this quiet reading hold.
    // A missing background Audio component would make this interval silent.
    const hold = Bun.spawn(
      [
        'ffmpeg',
        '-v',
        'error',
        '-ss',
        '6.2',
        '-i',
        video,
        '-t',
        '0.3',
        '-vn',
        '-f',
        's16le',
        '-',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const holdSamples = new Uint8Array(
      await new Response(hold.stdout).arrayBuffer(),
    )
    expect(await hold.exited).toBe(0)
    expect(holdSamples.some((byte) => byte !== 0)).toBe(true)
    await rm(path.join(isolated, 'output/media'), {
      recursive: true,
      force: true,
    })
    await command([...videoArgs, '--silent'], isolated)
    const silent = await metadata(video)
    expect(silent.streams.map((stream) => stream.codec_type)).toEqual(['video'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 300_000)
