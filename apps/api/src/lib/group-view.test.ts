import { describe, expect, it } from 'vitest'

import { generateGroupRouteId, isGroupRouteId } from './group-view'

describe('group route ids', () => {
  it('generates an ordinary-looking 128-bit hexadecimal route id', () => {
    const routeId = generateGroupRouteId()
    expect(routeId).toMatch(/^[a-f0-9]{32}$/)
    expect(isGroupRouteId(routeId)).toBe(true)
    expect(generateGroupRouteId()).not.toBe(routeId)
  })
})
