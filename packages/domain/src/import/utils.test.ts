import { describe, expect, it } from 'vitest'
import { appendImportedFromNote } from './utils'

describe('appendImportedFromNote', () => {
  it('joins an existing note with the source link on two newlines', () => {
    expect(
      appendImportedFromNote(
        'Group for the ski trip',
        'https://spliit.app/groups/abc',
      ),
    ).toBe(
      'Group for the ski trip\n\nImported from: https://spliit.app/groups/abc',
    )
  })

  it('uses only the source link when no existing note is provided', () => {
    expect(
      appendImportedFromNote(undefined, 'https://spliit.app/groups/abc'),
    ).toBe('Imported from: https://spliit.app/groups/abc')
    expect(appendImportedFromNote(null, 'https://spliit.app/groups/abc')).toBe(
      'Imported from: https://spliit.app/groups/abc',
    )
    expect(appendImportedFromNote('', 'https://spliit.app/groups/abc')).toBe(
      'Imported from: https://spliit.app/groups/abc',
    )
  })

  it('uses only the existing note when no source link is provided', () => {
    expect(appendImportedFromNote('Just a note', undefined)).toBe('Just a note')
    expect(appendImportedFromNote('Just a note', null)).toBe('Just a note')
    expect(appendImportedFromNote('Just a note', '')).toBe('Just a note')
  })

  it('returns undefined when neither is provided', () => {
    expect(appendImportedFromNote(undefined, undefined)).toBeUndefined()
    expect(appendImportedFromNote(null, null)).toBeUndefined()
    expect(appendImportedFromNote('', '')).toBeUndefined()
  })

  it('trims whitespace before deciding which branch to take', () => {
    expect(appendImportedFromNote('  ', 'https://spliit.app/groups/abc')).toBe(
      'Imported from: https://spliit.app/groups/abc',
    )
    expect(appendImportedFromNote('Group note', '  ')).toBe('Group note')
  })
})
