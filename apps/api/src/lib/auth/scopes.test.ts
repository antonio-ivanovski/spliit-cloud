import { describe, expect, it } from 'vitest'

import {
  ALL_SCOPES,
  DEFAULT_CLIENT_SCOPES,
  DESTRUCTIVE_SCOPES,
  SPLIIT_SCOPES,
  expandScopes,
  hasScope,
} from './scopes'

describe('scope catalogue', () => {
  it('never grants a destructive scope by default', () => {
    for (const scope of DESTRUCTIVE_SCOPES) {
      expect(DEFAULT_CLIENT_SCOPES).not.toContain(scope)
    }
  })

  it('still offers every destructive scope for explicit requests', () => {
    for (const scope of DESTRUCTIVE_SCOPES) {
      expect(ALL_SCOPES).toContain(scope)
    }
  })

  it('keeps the two scopes the MCP assistant already requests', () => {
    expect(DEFAULT_CLIENT_SCOPES).toContain(SPLIIT_SCOPES.groupsRead)
    expect(DEFAULT_CLIENT_SCOPES).toContain(SPLIIT_SCOPES.expensesWrite)
  })
})

describe('expandScopes', () => {
  it('treats write as implying read', () => {
    const expanded = expandScopes([SPLIIT_SCOPES.expensesWrite])

    expect(expanded.has(SPLIIT_SCOPES.expensesRead)).toBe(true)
  })

  it('treats delete as implying read', () => {
    const expanded = expandScopes([SPLIIT_SCOPES.groupsDelete])

    expect(expanded.has(SPLIIT_SCOPES.groupsRead)).toBe(true)
  })

  it('does not let a write scope imply anything on the other resource', () => {
    const expanded = expandScopes([SPLIIT_SCOPES.expensesWrite])

    expect(expanded.has(SPLIIT_SCOPES.groupsRead)).toBe(false)
    expect(expanded.has(SPLIIT_SCOPES.groupsWrite)).toBe(false)
  })

  it('never lets read imply write', () => {
    const expanded = expandScopes([
      SPLIIT_SCOPES.expensesRead,
      SPLIIT_SCOPES.groupsRead,
    ])

    expect(expanded.has(SPLIIT_SCOPES.expensesWrite)).toBe(false)
    expect(expanded.has(SPLIIT_SCOPES.groupsWrite)).toBe(false)
  })

  it('never lets write imply delete', () => {
    const expanded = expandScopes([
      SPLIIT_SCOPES.expensesWrite,
      SPLIIT_SCOPES.groupsWrite,
    ])

    expect(expanded.has(SPLIIT_SCOPES.expensesDelete)).toBe(false)
    expect(expanded.has(SPLIIT_SCOPES.groupsDelete)).toBe(false)
  })
})

describe('hasScope', () => {
  it('accepts a token minted before the read/write split', () => {
    // Tokens issued to the MCP assistant carry `expenses:write` without
    // `expenses:read`; reads must keep working for those clients.
    const granted = ['spliit:groups:read', 'spliit:expenses:write']

    expect(hasScope(granted, SPLIIT_SCOPES.expensesRead)).toBe(true)
    expect(hasScope(granted, SPLIIT_SCOPES.expensesWrite)).toBe(true)
  })

  it('rejects a scope that was never granted', () => {
    const granted = ['spliit:groups:read', 'spliit:expenses:write']

    expect(hasScope(granted, SPLIIT_SCOPES.expensesDelete)).toBe(false)
    expect(hasScope(granted, SPLIIT_SCOPES.groupsWrite)).toBe(false)
  })

  it('rejects everything for an empty grant', () => {
    for (const scope of Object.values(SPLIIT_SCOPES)) {
      expect(hasScope([], scope)).toBe(false)
    }
  })
})
