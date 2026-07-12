import { describe, expect, it } from 'vitest'
import { makeQueryClient } from './query-client'

describe('query client offline persistence defaults', () => {
  it('keeps inactive queries available to the persister', () => {
    expect(makeQueryClient().getDefaultOptions().queries?.gcTime).toBe(Infinity)
  })
})
