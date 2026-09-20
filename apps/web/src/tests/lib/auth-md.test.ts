import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const authMd = readFileSync(
  new URL('../../../public/auth.md', import.meta.url),
  'utf8',
)

describe('public/auth.md', () => {
  it('keeps the H1 the Auth.md scanner matches on', () => {
    const [firstLine] = authMd.split('\n')
    expect(firstLine).toMatch(/^# .*auth\.md/i)
  })

  it('publishes the agent_auth metadata the scanner looks for', () => {
    expect(authMd).toMatch(/```json[\s\S]*"agent_auth"[\s\S]*?```/)
    expect(authMd).toContain('"skill"')
    expect(authMd).toContain('"register_uri"')
    expect(authMd).toContain('"revocation_uri"')
    expect(authMd).toContain('"identity_types_supported": ["service_auth"]')
  })

  it('keeps well-known URLs out of inline code spans', () => {
    // The isitagentready.com authMd check appends the closing backtick when a
    // URL sits inside a code span, then probes `...resource%60` and 404s.
    expect(authMd).not.toMatch(/`[^\s`]*well-known|well-known[^\s`]*`/)
  })
})
