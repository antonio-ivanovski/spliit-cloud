import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { locales } from '@spliit/domain/i18n'

import {
  buildLocaleChunkIgnores,
  isLocaleChunkPath,
  PRECACHED_LOCALES,
} from './pwa-locale-chunks'

const ALL_LOCALES = [...locales]

function messageLocales(): string[] {
  const dir = join(import.meta.dirname, '../messages')
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort()
}

describe('locale chunk precache policy', () => {
  it('derives ignore entries for every non-default locale bundle', () => {
    expect(buildLocaleChunkIgnores(ALL_LOCALES)).toContain('assets/bn-BD-*.js')
    expect(buildLocaleChunkIgnores(ALL_LOCALES)).toContain('assets/pt-BR-*.js')
    for (const keep of PRECACHED_LOCALES) {
      expect(buildLocaleChunkIgnores(ALL_LOCALES)).not.toContain(
        `assets/${keep}-*.js`,
      )
    }
    expect(buildLocaleChunkIgnores(ALL_LOCALES)).toHaveLength(
      ALL_LOCALES.length - PRECACHED_LOCALES.length,
    )
  })

  it('matches hashed locale chunks without colliding with app chunks', () => {
    expect(isLocaleChunkPath('/assets/bn-BD-Bsijys88.js', ALL_LOCALES)).toBe(
      true,
    )
    // The chunk hash itself may contain dashes.
    expect(isLocaleChunkPath('/assets/en-GB-DWiwjUG-.js', ALL_LOCALES)).toBe(
      true,
    )
    expect(isLocaleChunkPath('/assets/pt-BR-CBfwzmwR.js', ALL_LOCALES)).toBe(
      true,
    )
    expect(isLocaleChunkPath('/assets/en-US-BSvLEO2F.js', ALL_LOCALES)).toBe(
      true,
    )
    expect(
      isLocaleChunkPath('/assets/query-worker-entry-DugHQOH4.js', ALL_LOCALES),
    ).toBe(false)
    expect(isLocaleChunkPath('/assets/esm-BjWJb4or.js', ALL_LOCALES)).toBe(
      false,
    )
    expect(isLocaleChunkPath('/assets/qr-code-DqNYCtCI.js', ALL_LOCALES)).toBe(
      false,
    )
    expect(isLocaleChunkPath('/assets/index-0fHWevXD.js', ALL_LOCALES)).toBe(
      false,
    )
    expect(isLocaleChunkPath('/assets/heic-to-CuP2Qlsw.js', ALL_LOCALES)).toBe(
      false,
    )
    expect(isLocaleChunkPath('/logo.svg', ALL_LOCALES)).toBe(false)
  })

  it('stays in sync with the message bundles on disk', () => {
    // The SW matcher (domain locales) and the build ignores (messages dir)
    // must agree; a new locale without both readers breaks offline switching.
    expect(messageLocales().sort()).toEqual([...ALL_LOCALES].sort())
  })
})
