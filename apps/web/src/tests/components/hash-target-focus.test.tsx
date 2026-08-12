import { afterEach, describe, expect, it, vi } from 'vitest'

import { HASH_FOCUS_MS, useHashTargetFocus } from '@/lib/use-hash-target-focus'
import { act, render, waitFor } from '@/test/test-utils'

function Probe({ hash }: { hash?: string }) {
  useHashTargetFocus(hash)
  return null
}

describe('useHashTargetFocus', () => {
  afterEach(() => {
    document.body.replaceChildren()
    window.history.replaceState({}, '', '/')
    vi.useRealTimers()
  })

  it('scrolls the hash target to the center and highlights it', () => {
    const scrollIntoView = vi.fn()
    const target = document.createElement('div')
    target.id = 'account-preference-mascot'
    target.scrollIntoView = scrollIntoView
    document.body.appendChild(target)

    render(<Probe hash="#account-preference-mascot" />)

    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center' }),
    )
    expect(target.getAttribute('data-hash-focus')).toBe('')
  })

  it('retries until a late-mounted notifications section exists', async () => {
    const scrollIntoView = vi.fn()
    render(<Probe hash="#notifications" />)
    expect(scrollIntoView).not.toHaveBeenCalled()

    const target = document.createElement('section')
    target.id = 'notifications'
    target.scrollIntoView = scrollIntoView
    act(() => {
      document.body.appendChild(target)
    })

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: 'center' }),
      )
    })
    expect(target.getAttribute('data-hash-focus')).toBe('')
  })

  it('clears the highlight after the pulse', () => {
    vi.useFakeTimers()
    const target = document.createElement('div')
    target.id = 'notifications'
    target.scrollIntoView = vi.fn()
    document.body.appendChild(target)

    render(<Probe hash="#notifications" />)
    expect(target.getAttribute('data-hash-focus')).toBe('')

    act(() => {
      vi.advanceTimersByTime(HASH_FOCUS_MS)
    })
    expect(target.hasAttribute('data-hash-focus')).toBe(false)
  })
})
