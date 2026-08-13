import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  HASH_FOCUS_MS,
  scrollElementToVisibleCenter,
  useHashTargetFocus,
} from '@/lib/use-hash-target-focus'
import { act, render, waitFor } from '@/test/test-utils'

function Probe({ hash }: { hash?: string }) {
  useHashTargetFocus(hash)
  return null
}

function mockRect(element: HTMLElement, top: number, height: number) {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      top,
      left: 0,
      right: 320,
      bottom: top + height,
      width: 320,
      height,
      toJSON() {
        return {}
      },
    }) as DOMRect
}

describe('useHashTargetFocus', () => {
  afterEach(() => {
    document.body.replaceChildren()
    window.history.replaceState({}, '', '/')
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('scrolls the hash target to the center of the visible viewport', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Object.defineProperty(window, 'scrollY', {
      value: 800,
      configurable: true,
    })
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      configurable: true,
    })

    const header = document.createElement('header')
    header.setAttribute('data-app-header', '')
    mockRect(header, 0, 64)
    document.body.appendChild(header)

    const target = document.createElement('div')
    target.id = 'account-preference-mascot'
    mockRect(target, 0, 80)
    document.body.appendChild(target)

    render(<Probe hash="#account-preference-mascot" />)

    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 408, behavior: 'smooth' }),
    )
    expect(target.getAttribute('data-hash-focus')).toBe('')
  })

  it('retries until a late-mounted notifications section exists', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(<Probe hash="#notifications" />)
    expect(scrollTo).not.toHaveBeenCalled()

    const target = document.createElement('section')
    target.id = 'notifications'
    mockRect(target, 120, 200)
    act(() => {
      document.body.appendChild(target)
    })

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth' }),
      )
    })
    expect(target.getAttribute('data-hash-focus')).toBe('')
  })

  it('clears the highlight after the pulse', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const target = document.createElement('div')
    target.id = 'notifications'
    mockRect(target, 0, 40)
    document.body.appendChild(target)

    render(<Probe hash="#notifications" />)
    expect(target.getAttribute('data-hash-focus')).toBe('')

    act(() => {
      vi.advanceTimersByTime(HASH_FOCUS_MS)
    })
    expect(target.hasAttribute('data-hash-focus')).toBe(false)
  })
})

describe('scrollElementToVisibleCenter', () => {
  afterEach(() => {
    document.body.replaceChildren()
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    vi.restoreAllMocks()
  })

  it('offsets by the visible header so the target is not covered', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Object.defineProperty(window, 'scrollY', {
      value: 800,
      configurable: true,
    })
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      configurable: true,
    })

    const header = document.createElement('header')
    header.setAttribute('data-app-header', '')
    mockRect(header, 0, 64)
    document.body.appendChild(header)

    const target = document.createElement('div')
    mockRect(target, 0, 80)
    document.body.appendChild(target)

    scrollElementToVisibleCenter(target, 'auto')

    expect(scrollTo).toHaveBeenCalledWith({ top: 408, behavior: 'auto' })
  })
})
