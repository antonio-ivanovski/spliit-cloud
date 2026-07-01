import { describe, expect, it } from 'vitest'
import { pickParser } from './source-step'

describe('pickParser', () => {
  it('routes .csv to spliit csv parser on spliit tab', () => {
    const picked = pickParser('spliit', 'group.csv')
    expect(picked.format).toBe('csv')
  })

  it('routes .json to spliit json parser on spliit tab', () => {
    const picked = pickParser('spliit', 'group.json')
    expect(picked.format).toBe('json')
  })

  it('routes .csv to splitwise csv parser on splitwise tab', () => {
    const picked = pickParser('splitwise', 'export.csv')
    expect(picked.format).toBe('csv')
  })

  it('rejects .json on splitwise tab (no json parser)', () => {
    const picked = pickParser('splitwise', 'export.json')
    expect(picked.format).toBeNull()
  })

  it('rejects unknown extensions', () => {
    expect(pickParser('spliit', 'group.txt').format).toBeNull()
    expect(pickParser('splitwise', 'export.xlsx').format).toBeNull()
  })

  it('rejects any file on tricount and settleup tabs', () => {
    expect(pickParser('tricount', 'anything.csv').format).toBeNull()
    expect(pickParser('settleup', 'anything.json').format).toBeNull()
  })

  it('matches extensions case-insensitively', () => {
    expect(pickParser('spliit', 'GROUP.CSV').format).toBe('csv')
    expect(pickParser('spliit', 'group.JSON').format).toBe('json')
  })
})
