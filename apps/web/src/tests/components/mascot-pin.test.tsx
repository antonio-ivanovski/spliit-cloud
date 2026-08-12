import { describe, expect, it } from 'vitest'

import {
  clampPin,
  dialPlacementFromPin,
  dropHitsReject,
  mascotPinKey,
  readMascotPin,
  writeMascotPin,
} from '@/components/mascot/mascot-pin'

describe('mascot pin', () => {
  it('clamps a pin to stay on-screen', () => {
    const pin = clampPin({ x: -10, y: 140 }, 108, 118, 1000, 800)
    expect(pin.x).toBeGreaterThan(0)
    expect(pin.x).toBeLessThan(50)
    expect(pin.y).toBeLessThan(100)
    expect(pin.y).toBeGreaterThan(50)
  })

  it('picks a dial quadrant from the pin', () => {
    expect(dialPlacementFromPin(null)).toBe('bottom-end')
    expect(dialPlacementFromPin({ x: 20, y: 20 })).toBe('top-start')
    expect(dialPlacementFromPin({ x: 80, y: 20 })).toBe('top-end')
    expect(dialPlacementFromPin({ x: 20, y: 80 })).toBe('bottom-start')
    expect(dialPlacementFromPin({ x: 80, y: 80 })).toBe('bottom-end')
  })

  it('persists and clears a pin per account', () => {
    localStorage.clear()
    writeMascotPin('account-1', { x: 40, y: 60 })
    expect(readMascotPin('account-1')).toEqual(clampPin({ x: 40, y: 60 }))
    expect(localStorage.getItem(mascotPinKey('account-1'))).toBeTruthy()
    writeMascotPin('account-1', null)
    expect(readMascotPin('account-1')).toBeNull()
  })

  it('rejects a drop that overlaps a header strip', () => {
    const header = document.createElement('div')
    header.setAttribute('data-app-header', '')
    Object.defineProperty(header, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        right: 400,
        top: 0,
        bottom: 64,
        width: 400,
        height: 64,
      }),
    })
    document.body.append(header)

    expect(dropHitsReject(50, 20, 108, 118)).toBe(true)
    expect(dropHitsReject(200, 400, 108, 118)).toBe(false)

    header.remove()
  })

  it('ignores zero-size reject nodes', () => {
    const fab = document.createElement('div')
    fab.setAttribute('data-create-expense-fab', '')
    Object.defineProperty(fab, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: 0,
        height: 0,
      }),
    })
    document.body.append(fab)

    expect(dropHitsReject(10, 10, 108, 118)).toBe(false)
    fab.remove()
  })
})
