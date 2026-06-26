import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { locales } from '../../../packages/domain/src/i18n.ts'
import {
  LOCALE_TO_FILE,
  addString,
  diffMessages,
  flattenKeys,
  getAt,
  getMessagesDir,
  missingKeys,
  removeAt,
  removeString,
  reorderSiblings,
  setAt,
  setMessagesDir,
  setString,
  validateAllMessages,
} from './lib.ts'

let dir: string

async function seedFile(locale: keyof typeof LOCALE_TO_FILE, data: unknown) {
  await writeFile(
    join(dir, LOCALE_TO_FILE[locale]),
    JSON.stringify(data, null, 2) + '\n',
  )
}

async function readFileJson(locale: keyof typeof LOCALE_TO_FILE) {
  return JSON.parse(await readFile(join(dir, LOCALE_TO_FILE[locale]), 'utf8'))
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'i18n-test-'))
  await mkdir(dir, { recursive: true })
  setMessagesDir(dir)
  for (const locale of Object.keys(LOCALE_TO_FILE) as Array<
    keyof typeof LOCALE_TO_FILE
  >) {
    await writeFile(join(dir, LOCALE_TO_FILE[locale]), '{}\n')
  }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('getAt', () => {
  it('reads nested values', () => {
    expect(getAt({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42)
  })

  it('reads from arrays', () => {
    expect(getAt({ a: ['x', 'y', 'z'] }, 'a.1')).toBe('y')
  })

  it('returns undefined for missing paths', () => {
    expect(getAt({ a: 1 }, 'a.b.c')).toBeUndefined()
  })

  it('accepts array path form', () => {
    expect(getAt({ a: { b: 'hi' } }, ['a', 'b'])).toBe('hi')
  })

  it('treats empty paths as the root', () => {
    const obj = { a: 1 }
    expect(getAt(obj, '')).toBe(obj)
    expect(getAt({ a: 1 }, '.a.')).toBe(1)
  })
})

describe('setAt', () => {
  it('sets nested values and creates intermediate objects', () => {
    const obj: Record<string, unknown> = {}
    setAt(obj, 'a.b.c', 'x')
    expect(obj).toEqual({ a: { b: { c: 'x' } } })
  })

  it('overwrites existing leaf values', () => {
    const obj: Record<string, unknown> = { a: { b: 'old' } }
    setAt(obj, 'a.b', 'new')
    expect(obj).toEqual({ a: { b: 'new' } })
  })

  it('throws on empty path', () => {
    expect(() => setAt({}, '', 'x')).toThrow()
  })
})

describe('removeAt', () => {
  it('removes a leaf and returns true', () => {
    const obj = { a: { b: 'x' } }
    expect(removeAt(obj, 'a.b')).toBe(true)
    expect(obj).toEqual({ a: {} })
  })

  it('returns false for missing paths', () => {
    expect(removeAt({ a: 1 }, 'b')).toBe(false)
    expect(removeAt({ a: { b: 1 } }, 'a.c')).toBe(false)
  })
})

describe('flattenKeys', () => {
  it('returns dotted paths for all leaves', () => {
    expect(flattenKeys({ a: { b: 1, c: { d: 2 } }, e: 3 }).sort()).toEqual([
      'a.b',
      'a.c.d',
      'e',
    ])
  })

  it('returns [] for non-objects', () => {
    expect(flattenKeys(null)).toEqual([])
    expect(flattenKeys('x')).toEqual([])
    expect(flattenKeys([1, 2])).toEqual([])
  })
})

describe('reorderSiblings', () => {
  it('inserts the new key just before the next reference sibling', () => {
    const parent: Record<string, unknown> = { A: 1, C: 3, X: 'x' }
    const ref: Record<string, unknown> = { A: 1, B: 2, C: 3 }
    parent['B'] = 2
    reorderSiblings(parent, ref, 'B')
    expect(Object.keys(parent)).toEqual(['A', 'B', 'C', 'X'])
  })

  it('appends at the end when the key is the last in the reference', () => {
    const parent: Record<string, unknown> = { A: 1, B: 2 }
    const ref: Record<string, unknown> = { A: 1, B: 2, C: 3 }
    parent['C'] = 3
    reorderSiblings(parent, ref, 'C')
    expect(Object.keys(parent)).toEqual(['A', 'B', 'C'])
  })

  it('inserts at the start when no earlier reference sibling exists in parent', () => {
    const parent: Record<string, unknown> = { B: 2, C: 3 }
    const ref: Record<string, unknown> = { A: 1, B: 2, C: 3 }
    parent['A'] = 1
    reorderSiblings(parent, ref, 'A')
    expect(Object.keys(parent)).toEqual(['A', 'B', 'C'])
  })

  it('does nothing if the key is not in the reference', () => {
    const parent: Record<string, unknown> = { A: 1 }
    const ref: Record<string, unknown> = { A: 1 }
    parent['Z'] = 'z'
    reorderSiblings(parent, ref, 'Z')
    expect(Object.keys(parent)).toEqual(['A', 'Z'])
  })

  it('does nothing if the key is not in the parent', () => {
    const parent: Record<string, unknown> = { A: 1 }
    const ref: Record<string, unknown> = { A: 1, B: 2 }
    reorderSiblings(parent, ref, 'B')
    expect(Object.keys(parent)).toEqual(['A'])
  })
})

describe('addString', () => {
  it('writes only to en-US and creates intermediate objects', async () => {
    await seedFile('en-US', { Existing: 'v' })
    await seedFile('fr-FR', { Existing: 'v' })
    await addString('New.deep.key', 'hello')
    expect(await readFileJson('en-US')).toEqual({
      Existing: 'v',
      New: { deep: { key: 'hello' } },
    })
    expect(await readFileJson('fr-FR')).toEqual({ Existing: 'v' })
  })

  it('preserves the original 2-space indent + trailing newline', async () => {
    await seedFile('en-US', {})
    await addString('a', 'b')
    const raw = await readFile(join(dir, 'en-US.json'), 'utf8')
    expect(raw).toBe('{\n  "a": "b"\n}\n')
  })
})

describe('setString', () => {
  it('sets in any locale', async () => {
    await seedFile('en-US', { a: 'a' })
    await seedFile('fr-FR', { a: 'a' })
    await setString('fr-FR', 'a', 'A')
    expect((await readFileJson('fr-FR')).a).toBe('A')
  })

  it('appends to en-US without reordering (matches en-US convention)', async () => {
    await seedFile('en-US', { A: 'a', B: 'b' })
    await setString('en-US', 'C', 'c')
    expect(Object.keys(await readFileJson('en-US'))).toEqual(['A', 'B', 'C'])
  })

  it('inserts into a non-en-US locale at en-US-relative position', async () => {
    await seedFile('en-US', { A: 'a', B: 'b', C: 'c', D: 'd' })
    await seedFile('fr-FR', { A: 'A', C: 'C', X: 'X' })
    await setString('fr-FR', 'B', 'B-fr')
    expect(Object.keys(await readFileJson('fr-FR'))).toEqual([
      'A',
      'B',
      'C',
      'X',
    ])
  })

  it('appends at end when the new key is last in en-US', async () => {
    await seedFile('en-US', { A: 'a', B: 'b' })
    await seedFile('fr-FR', { A: 'A' })
    await setString('fr-FR', 'B', 'B-fr')
    expect(Object.keys(await readFileJson('fr-FR'))).toEqual(['A', 'B'])
  })

  it('inserts at start when the new key is first in en-US and missing in target', async () => {
    await seedFile('en-US', { A: 'a', B: 'b' })
    await seedFile('fr-FR', { B: 'B' })
    await setString('fr-FR', 'A', 'A-fr')
    expect(Object.keys(await readFileJson('fr-FR'))).toEqual(['A', 'B'])
  })
})

describe('removeString', () => {
  it('removes the key from en-US and from any locale that has it', async () => {
    await seedFile('en-US', { a: 'a', b: 'b' })
    await seedFile('fr-FR', { a: 'a', b: 'b' })
    await seedFile('de-DE', { a: 'a' })
    const count = await removeString('b')
    expect(count).toBe(2)
    expect(await readFileJson('en-US')).toEqual({ a: 'a' })
    expect(await readFileJson('fr-FR')).toEqual({ a: 'a' })
    expect(await readFileJson('de-DE')).toEqual({ a: 'a' })
  })

  it('cleans up empty parents recursively', async () => {
    await seedFile('en-US', { a: { b: { c: 'x' } } })
    await removeString('a.b.c')
    expect(await readFileJson('en-US')).toEqual({})
  })

  it('keeps non-empty parents intact after cleaning up', async () => {
    await seedFile('en-US', { a: { b: 'b', c: 'c' } })
    await removeString('a.b')
    expect(await readFileJson('en-US')).toEqual({ a: { c: 'c' } })
  })

  it('returns 0 when nothing was removed', async () => {
    await seedFile('en-US', { a: 'a' })
    expect(await removeString('missing')).toBe(0)
  })
})

describe('missingKeys', () => {
  it('lists all en-US keys not present in target, sorted', async () => {
    await seedFile('en-US', { a: 'a', b: 'b', c: { d: 'd' } })
    await seedFile('fr-FR', { a: 'A', c: {} })
    expect(await missingKeys('fr-FR')).toEqual(['b', 'c.d'])
  })

  it('returns [] when target is complete', async () => {
    await seedFile('en-US', { a: 'a', b: { c: 'c' } })
    await seedFile('fr-FR', { a: 'A', b: { c: 'C' } })
    expect(await missingKeys('fr-FR')).toEqual([])
  })
})

describe('validateAllMessages', () => {
  it('passes when no orphans exist', async () => {
    for (const locale of locales) await seedFile(locale, {})
    const result = await validateAllMessages()
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('fails with a descriptive error for orphan keys', async () => {
    await seedFile('en-US', { good: 'g' })
    await seedFile('fr-FR', { good: 'G', orphan: 'O' })
    const result = await validateAllMessages()
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('orphan')
    expect(result.errors[0]).toContain('orphan')
    expect(result.errors[0]).toContain('fr-FR.json')
  })
})

describe('diffMessages', () => {
  it('classifies keys as added when present only in working tree', async () => {
    await seedFile('en-US', { old: 'o', brandNew: 'b' })
    const result = await diffMessages({
      readOldEn: async () => ({ old: 'o' }),
    })
    expect(result.thisChange.added).toEqual(['brandNew'])
    expect(result.thisChange.modified).toEqual([])
    expect(result.thisChange.removed).toEqual([])
  })

  it('classifies modified values separately from pure additions', async () => {
    await seedFile('en-US', { same: 'SAME', changed: 'NEW' })
    const result = await diffMessages({
      readOldEn: async () => ({ same: 'SAME', changed: 'OLD' }),
    })
    expect(result.thisChange.added).toEqual([])
    expect(result.thisChange.modified).toEqual(['changed'])
  })

  it('partitions translation work into translationWork vs legacyMissing', async () => {
    await seedFile('en-US', { old: 'o', new1: 'n1', new2: 'n2' })
    await seedFile('fr-FR', { old: 'o', new1: 'N1' })
    const result = await diffMessages({
      locale: 'fr-FR',
      readOldEn: async () => ({ old: 'o' }),
    })
    expect(result.translationWork['fr-FR'].missing).toEqual(['new2'])
    expect(result.translationWork['fr-FR'].present).toEqual(['new1'])
    expect(result.legacyMissing['fr-FR']).toBe(0)
  })

  it('counts legacyMissing for pre-existing missing keys', async () => {
    await seedFile('en-US', { kept: 'k', lost1: 'l1', lost2: 'l2', new1: 'n1' })
    await seedFile('fr-FR', { kept: 'K' })
    const result = await diffMessages({
      locale: 'fr-FR',
      readOldEn: async () => ({ kept: 'k', lost1: 'l1', lost2: 'l2' }),
    })
    expect(result.translationWork['fr-FR'].missing).toEqual(['new1'])
    expect(result.legacyMissing['fr-FR']).toBe(2)
  })
})

describe('getMessagesDir / setMessagesDir', () => {
  it('returns the currently configured dir', () => {
    setMessagesDir('/tmp/example')
    expect(getMessagesDir()).toBe('/tmp/example')
  })
})
