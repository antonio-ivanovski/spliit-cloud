import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// Guards the Docker/nginx deployment (nginx.web.conf) against drifting out
// of sync with the Cloudflare Pages worker (public/_worker.js): every public
// page with a Markdown companion must negotiate text/markdown in both.
const workerSource = readFileSync(
  new URL('../../public/_worker.js', import.meta.url),
  'utf8',
)
const nginxSource = readFileSync(
  new URL('../../../../nginx.web.conf', import.meta.url),
  'utf8',
)
const indexHtml = readFileSync(
  new URL('../../index.html', import.meta.url),
  'utf8',
)

const workerPages = [
  ...workerSource.matchAll(/\[\s*'([^']+)',\s*'(\/[^']+\.md)'\s*\]/g),
].map(([, page = '', asset = '']) => ({ page, asset }))

function alternation(source: string, pattern: RegExp): string[] {
  const match = source.match(pattern)
  expect(match?.[1], String(pattern)).toBeDefined()
  return (match?.[1] ?? '').split('|').sort()
}

describe('nginx markdown negotiation parity', () => {
  it('negotiates every worker markdown page (root served separately)', () => {
    const nginxPages = alternation(
      nginxSource,
      /location ~ \^\/\(([^)]+)\)\/\?\$\s*\{/,
    )
    const workerNegotiated = workerPages
      .map(({ page }) => page)
      .filter((page) => page !== '/')
      .map((page) => page.slice(1))
      .sort()
    expect(nginxPages).toEqual(workerNegotiated)
  })

  it('advertises the same pages as Markdown alternates via $request_uri', () => {
    const mapPages = alternation(
      nginxSource,
      /map \$request_uri[\s\S]*?~\^\/\(([^)]+)\)\/\?/,
    )
    const workerNegotiated = workerPages
      .map(({ page }) => page)
      .filter((page) => page !== '/')
      .map((page) => page.slice(1))
      .sort()
    expect(mapPages).toEqual(workerNegotiated)
    expect(nginxSource).toContain(
      '\'</$1.md>; rel="alternate"; type="text/markdown"\'',
    )
    expect(nginxSource).toContain(
      '\'</index.md>; rel="alternate"; type="text/markdown"\'',
    )
  })

  it('serves the root companion and emits the Link header from HTML', () => {
    expect(nginxSource).toMatch(
      /location = \/ \{\s*\n\s*if \(\$spliit_accepts_markdown = 1\) \{\s*\n\s*rewrite \^ \/index\.md last;/,
    )
    expect(nginxSource).toContain(
      'add_header Link $spliit_markdown_alternate always;',
    )
  })
})

describe('static crawler fallback', () => {
  it('links every markdown companion from the shell noscript block', () => {
    expect(indexHtml).toContain('id="crawler-fallback"')
    for (const { asset } of workerPages) {
      expect(indexHtml, asset).toContain(`href="${asset}"`)
    }
  })
})
