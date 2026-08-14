import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** Historical same-prefix pair already applied; do not add more collisions. */
const GRANDFATHERED_PREFIX_COLLISIONS = new Set(['20260813120000'])

describe('prisma migration folder names', () => {
  it('uses unique YYYYMMDDHHmmss prefixes except known historical collisions', () => {
    const migrationsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../prisma/migrations',
    )
    const folders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
      .map((entry) => entry.name)
      .sort()

    expect(folders.length).toBeGreaterThan(0)

    const byPrefix = new Map<string, string[]>()
    for (const name of folders) {
      const prefix = name.slice(0, 14)
      const existing = byPrefix.get(prefix) ?? []
      existing.push(name)
      byPrefix.set(prefix, existing)
    }

    const unexpected = [...byPrefix.entries()].filter(
      ([prefix, names]) =>
        names.length > 1 &&
        (!GRANDFATHERED_PREFIX_COLLISIONS.has(prefix) || names.length > 2),
    )
    expect(unexpected).toEqual([])
  })
})
