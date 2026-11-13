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

function exactLocation(path: string): string {
  const marker = `location = ${path} {`
  const start = nginxSource.indexOf(marker)
  expect(start, marker).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (
    let index = start + marker.length - 1;
    index < nginxSource.length;
    index++
  ) {
    if (nginxSource[index] === '{') {
      depth += 1
    } else if (nginxSource[index] === '}') {
      depth -= 1
      if (depth === 0) return nginxSource.slice(start, index + 1)
    }
  }
  throw new Error(`Unterminated nginx location block for ${path}`)
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

describe('auth SPA page routing', () => {
  const authPages = [
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/complete-profile',
  ]

  for (const page of authPages) {
    it(`serves ${page} as the SPA for GET/HEAD and proxies other methods`, () => {
      const block = exactLocation(page)
      expect(block).toMatch(
        /if \(\$request_method ~ \^\(GET\|HEAD\)\$\) \{\s*\n\s*rewrite \^ \/index\.html last;\s*\n\s*\}/,
      )
      expect(block).toMatch(/\}\s*\n\s*proxy_pass http:\/\/api:3001;/)
      expect(block).not.toContain('try_files')
    })
  }
})

describe('static crawler fallback', () => {
  it('links every markdown companion from the shell noscript block', () => {
    expect(indexHtml).toContain('id="crawler-fallback"')
    for (const { asset } of workerPages) {
      expect(indexHtml, asset).toContain(`href="${asset}"`)
    }
  })
})
