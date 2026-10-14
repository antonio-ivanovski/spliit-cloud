import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { chromium, type Browser } from '@playwright/test'

import { selectCampaign } from '../src/catalog'

const root = path.resolve(import.meta.dirname, '..')

async function render() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      campaign: { type: 'string' },
      variant: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.help) {
    console.log(
      'Usage: bun --filter @spliit/promo render --campaign <id> [--variant <name>] [--out <directory>]\nOmit --variant to export every variant. --out is relative to the working directory (apps/promo when using Bun --filter).',
    )
    return
  }
  if (!values.campaign)
    throw new Error('Missing --campaign. Use --help for usage.')
  const { campaign, variants } = selectCampaign(values.campaign, values.variant)
  const output = values.out
    ? path.resolve(values.out)
    : path.join(root, 'output')
  let browser: Browser | undefined
  let server: ReturnType<typeof Bun.serve> | undefined
  let build: ReturnType<typeof Bun.spawn> | undefined
  const cleanup = async () => {
    build?.kill()
    try {
      await browser?.close()
    } finally {
      await server?.stop(true)
    }
  }
  const interrupt = () => {
    void cleanup().finally(() => process.exit(130))
  }
  const terminate = () => {
    void cleanup().finally(() => process.exit(143))
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    build = Bun.spawn(['bun', 'run', 'build'], {
      cwd: root,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await build.exited
    build = undefined
    if (exitCode !== 0)
      throw new Error(`Promo build failed (exit ${exitCode}).`)
    await mkdir(output, { recursive: true })
    const dist = path.join(root, 'dist')
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return new Response('Method not allowed', { status: 405 })
        const pathname = decodeURIComponent(new URL(request.url).pathname)
        const filename = path.resolve(
          dist,
          `.${pathname === '/' ? '/index.html' : pathname}`,
        )
        if (!filename.startsWith(`${dist}${path.sep}`))
          return new Response('Forbidden', { status: 403 })
        const file = Bun.file(filename)
        if (!(await file.exists()))
          return new Response('Not found', { status: 404 })
        return new Response(file)
      },
    })
    try {
      browser = await chromium.launch()
    } catch (error) {
      throw new Error(
        'Chromium could not start. If it is missing, install it with: bun --filter @spliit/promo browser:install',
        { cause: error },
      )
    }
    const origin = server.url.origin
    for (const [variant, size] of variants) {
      const context = await browser.newContext({
        viewport: size,
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
      })
      try {
        const page = await context.newPage()
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text())
        })
        page.on('response', (response) => {
          if (response.status() >= 400)
            errors.push(`${response.status()}: ${response.url()}`)
        })
        await page.route('**/*', (route) => {
          if (new URL(route.request().url()).origin === origin)
            return route.continue()
          errors.push(
            `External request is not supported: ${route.request().url()}`,
          )
          return route.abort()
        })
        const query = new URLSearchParams({ campaign: campaign.id, variant })
        await page.goto(`${origin}/?${query}`, { waitUntil: 'load' })
        const failure = page.locator('[data-promo-error]')
        if (await failure.count()) throw new Error(await failure.innerText())
        const canvas = page.locator('[data-promo-canvas]')
        await canvas.waitFor({ state: 'visible' })
        await page.evaluate(async () => {
          await document.fonts.ready
          await Promise.all(
            Array.from(document.images, (image) => image.decode()),
          )
        })
        const bounds = await canvas.boundingBox()
        if (
          !bounds ||
          bounds.width !== size.width ||
          bounds.height !== size.height
        )
          throw new Error(`Unexpected canvas size for ${variant}.`)
        const overflow = await canvas.evaluate(
          (element) =>
            element.scrollWidth > element.clientWidth ||
            element.scrollHeight > element.clientHeight,
        )
        if (overflow)
          throw new Error(
            `Canvas content overflows in ${variant}; inspect the layout before exporting.`,
          )
        if (errors.length) throw new Error(errors.join('\n'))
        const filename = path.join(output, `${campaign.id}-${variant}.png`)
        await canvas.screenshot({
          path: filename,
          animations: 'disabled',
          scale: 'css',
        })
        console.log(`Exported ${size.width}×${size.height}: ${filename}`)
      } finally {
        await context.close()
      }
    }
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
    await cleanup()
  }
}

try {
  await render()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
