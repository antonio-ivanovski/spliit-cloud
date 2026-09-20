import { describe, expect, it } from 'vitest'

import { prefillAppearanceFromManifest } from './import-wizard-state'

describe('prefillAppearanceFromManifest', () => {
  it('passes valid export appearance through', () => {
    expect(
      prefillAppearanceFromManifest({ emoji: '🍻', color: 'teal' }),
    ).toEqual({ emoji: '🍻', color: 'teal' })
  })

  it('normalizes an uppercase hex export color', () => {
    expect(
      prefillAppearanceFromManifest({ emoji: '🍻', color: '#A1B2C3' }),
    ).toEqual({ emoji: '🍻', color: '#a1b2c3' })
  })

  it('keeps explicit-none export values', () => {
    expect(prefillAppearanceFromManifest({ emoji: '', color: null })).toEqual({
      emoji: '',
      color: null,
    })
  })

  it('maps undecided export values to undecided', () => {
    expect(
      prefillAppearanceFromManifest({ emoji: null, color: undefined }),
    ).toEqual({ emoji: undefined, color: undefined })
    expect(prefillAppearanceFromManifest({})).toEqual({
      emoji: undefined,
      color: undefined,
    })
  })

  it('blanks invalid export values', () => {
    expect(
      prefillAppearanceFromManifest({ emoji: 'not-emoji', color: 'blurple' }),
    ).toEqual({ emoji: undefined, color: undefined })
  })
})
