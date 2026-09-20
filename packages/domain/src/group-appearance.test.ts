import {
  GROUP_COLOR_HEX,
  GROUP_COLOR_IDS,
  detectEmojiInName,
  displayEmoji,
  extractSingleTitleEmoji,
  isEmojiDeclined,
  isEmojiUndecided,
  isGroupColor,
  isGroupColorId,
  isSingleEmoji,
  normalizeEmojiInput,
  normalizeHexColor,
  resolveGroupColorHex,
  stripNameEmoji,
} from './group-appearance'

describe('detectEmojiInName', () => {
  it('returns null for names without emoji', () => {
    expect(detectEmojiInName('Weekend Trip')).toBeNull()
    expect(detectEmojiInName('')).toBeNull()
    expect(detectEmojiInName('2 day trip')).toBeNull()
  })

  it('finds the first emoji anywhere in the name', () => {
    expect(detectEmojiInName('Weekend Trip 🏝️')).toBe('🏝️')
    expect(detectEmojiInName('🏝️ Weekend Trip')).toBe('🏝️')
    expect(detectEmojiInName('Weekend 🏝️ Trip 🎉')).toBe('🏝️')
  })

  it('keeps variation selectors in the detected grapheme', () => {
    expect(detectEmojiInName('Love ❤️ group')).toBe('❤️')
  })

  it('does not treat keycap digits as emoji', () => {
    expect(detectEmojiInName('Trip 1️⃣')).toBeNull()
  })

  it('does not treat a lone flag half as an emoji', () => {
    expect(detectEmojiInName('🇵 trip')).toBeNull()
    expect(detectEmojiInName('🇵')).toBeNull()
  })
})

describe('isSingleEmoji', () => {
  it('accepts a single emoji grapheme', () => {
    expect(isSingleEmoji('🏝️')).toBe(true)
    expect(isSingleEmoji('🎉')).toBe(true)
    expect(isSingleEmoji('❤️')).toBe(true)
    expect(isSingleEmoji('🇵🇹')).toBe(true)
  })

  it('rejects text, empty strings, and multiple emoji', () => {
    expect(isSingleEmoji('')).toBe(false)
    expect(isSingleEmoji('trip')).toBe(false)
    expect(isSingleEmoji('🏝️🎉')).toBe(false)
    expect(isSingleEmoji('🏝️ trip')).toBe(false)
  })

  it('rejects a lone regional indicator', () => {
    expect(isSingleEmoji('🇵')).toBe(false)
    expect(isSingleEmoji('🇵 🇹')).toBe(false)
  })
})

describe('normalizeEmojiInput', () => {
  it('maps blank input to the declined sentinel', () => {
    expect(normalizeEmojiInput('')).toBe('')
    expect(normalizeEmojiInput('   ')).toBe('')
  })

  it('keeps a single emoji as-is', () => {
    expect(normalizeEmojiInput('🏝️')).toBe('🏝️')
    expect(normalizeEmojiInput('  🎉  ')).toBe('🎉')
  })

  it('extracts the first emoji from pasted text', () => {
    expect(normalizeEmojiInput('hello 🏝️ world')).toBe('🏝️')
  })

  it('passes invalid text through so validation can reject it', () => {
    expect(normalizeEmojiInput('trip')).toBe('trip')
    expect(normalizeEmojiInput('🇵')).toBe('🇵')
  })
})

describe('stripNameEmoji', () => {
  it('removes the emoji and tidies separators', () => {
    expect(stripNameEmoji('🏝️ Weekend Trip', '🏝️')).toBe('Weekend Trip')
    expect(stripNameEmoji('Weekend Trip 🏝️', '🏝️')).toBe('Weekend Trip')
    expect(stripNameEmoji('Weekend 🏝️ Trip', '🏝️')).toBe('Weekend Trip')
  })

  it('returns the original name when stripping would leave it empty', () => {
    expect(stripNameEmoji('🏝️', '🏝️')).toBe('🏝️')
  })

  it('leaves an empty remainder when allowEmpty is set', () => {
    expect(stripNameEmoji('🏝️', '🏝️', true)).toBe('')
  })

  it('returns the original name when the emoji is absent', () => {
    expect(stripNameEmoji('Weekend Trip', '🏝️')).toBe('Weekend Trip')
  })
})

describe('extractSingleTitleEmoji', () => {
  it('extracts a single title emoji anywhere in the name', () => {
    expect(extractSingleTitleEmoji('🏝️ Weekend Trip')).toEqual({
      emoji: '🏝️',
      strippedName: 'Weekend Trip',
    })
    expect(extractSingleTitleEmoji('Weekend Trip 🏝️')).toEqual({
      emoji: '🏝️',
      strippedName: 'Weekend Trip',
    })
    expect(extractSingleTitleEmoji('Weekend 🏝️ Trip')).toEqual({
      emoji: '🏝️',
      strippedName: 'Weekend Trip',
    })
  })

  it('returns null when the name has no emoji', () => {
    expect(extractSingleTitleEmoji('Weekend Trip')).toBeNull()
    expect(extractSingleTitleEmoji('')).toBeNull()
    expect(extractSingleTitleEmoji('Trip 1️⃣')).toBeNull()
  })

  it('keeps deliberate multi-emoji decoration in the name', () => {
    expect(extractSingleTitleEmoji('🎉🎊 Party')).toBeNull()
    expect(extractSingleTitleEmoji('Party 🎉🎊')).toBeNull()
    expect(extractSingleTitleEmoji('🎉 Party 🎉')).toBeNull()
  })

  it('transfers an emoji-only name, leaving the name empty', () => {
    expect(extractSingleTitleEmoji('🏝️')).toEqual({
      emoji: '🏝️',
      strippedName: '',
    })
  })

  it('strips even when the remainder is a single character', () => {
    expect(extractSingleTitleEmoji('🏝️ A')).toEqual({
      emoji: '🏝️',
      strippedName: 'A',
    })
  })
})

describe('emoji tri-state helpers', () => {
  it('classifies undecided values', () => {
    expect(isEmojiUndecided(null)).toBe(true)
    expect(isEmojiUndecided(undefined)).toBe(true)
    expect(isEmojiUndecided('')).toBe(false)
    expect(isEmojiUndecided('🏝️')).toBe(false)
  })

  it('classifies the declined sentinel', () => {
    expect(isEmojiDeclined('')).toBe(true)
    expect(isEmojiDeclined(null)).toBe(false)
    expect(isEmojiDeclined('🏝️')).toBe(false)
  })

  it('only renders a display emoji for picked values', () => {
    expect(displayEmoji('🏝️')).toBe('🏝️')
    expect(displayEmoji('')).toBeNull()
    expect(displayEmoji(null)).toBeNull()
    expect(displayEmoji(undefined)).toBeNull()
  })
})

describe('hex color helpers', () => {
  it('normalizes free-form hex input', () => {
    expect(normalizeHexColor('#A1B2C3')).toBe('#a1b2c3')
    expect(normalizeHexColor('a1b2c3')).toBe('#a1b2c3')
    expect(normalizeHexColor('  #abc ')).toBe('#aabbcc')
    expect(normalizeHexColor('#12345')).toBeNull()
    expect(normalizeHexColor('#gggggg')).toBeNull()
    expect(normalizeHexColor('teal')).toBeNull()
    expect(normalizeHexColor('')).toBeNull()
  })

  it('classifies palette ids, stored hex, and rejects input-shorthand forms', () => {
    expect(isGroupColorId('teal')).toBe(true)
    expect(isGroupColorId('chartreuse')).toBe(false)
    expect(isGroupColor('teal')).toBe(true)
    expect(isGroupColor('#a1b2c3')).toBe(true)
    expect(isGroupColor('#A1B2C3')).toBe(true)
    expect(isGroupColor('a1b2c3')).toBe(false)
    expect(isGroupColor('#abc')).toBe(false)
    expect(isGroupColor('chartreuse')).toBe(false)
  })

  it('resolves palette ids and custom hex to a hex value', () => {
    expect(resolveGroupColorHex('teal')).toBe(GROUP_COLOR_HEX.teal)
    expect(resolveGroupColorHex('#A1B2C3')).toBe('#a1b2c3')
    expect(resolveGroupColorHex('chartreuse')).toBeNull()
    expect(resolveGroupColorHex(null)).toBeNull()
    expect(resolveGroupColorHex(undefined)).toBeNull()
  })

  it('resolves every standard palette id to a hex value', () => {
    expect(GROUP_COLOR_IDS.length).toBeGreaterThan(10)
    for (const id of GROUP_COLOR_IDS) {
      expect(resolveGroupColorHex(id)).toBe(GROUP_COLOR_HEX[id])
    }
  })
})
