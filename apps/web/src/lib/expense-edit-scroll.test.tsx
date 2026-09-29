import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  captureExpenseEditScroll,
  discardExpenseEditScrollOutside,
  useRestoreExpenseEditScroll,
} from './expense-edit-scroll'

let nextFrame: FrameRequestCallback | undefined

function setPageScroll(
  scrollY: number,
  scrollHeight: number,
  innerHeight = 500,
) {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: scrollY,
  })
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  })
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: innerHeight,
  })
}

function renderNextFrame() {
  act(() => {
    nextFrame?.(0)
    nextFrame = undefined
  })
}

describe('expense edit scroll restoration', () => {
  beforeEach(() => {
    nextFrame = undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  afterEach(() => {
    discardExpenseEditScrollOutside('/unrelated')
    window.history.replaceState({}, '', '/')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('restores a mounted group list after returning from edit', () => {
    window.history.replaceState(
      {},
      '',
      '/groups/grp-1/expenses/exp-1?expCategories=food',
    )
    setPageScroll(800, 2000)
    captureExpenseEditScroll('grp-1', 'exp-1')

    window.history.replaceState(
      {},
      '',
      '/groups/grp-1/expenses/exp-1?expCategories=food',
    )
    const { unmount } = renderHook(() =>
      useRestoreExpenseEditScroll(true, 'grp-1'),
    )
    renderNextFrame()

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 800,
      behavior: 'auto',
    })

    unmount()
    vi.mocked(window.scrollTo).mockClear()
    renderHook(() => useRestoreExpenseEditScroll(true, 'grp-1'))
    expect(nextFrame).toBeUndefined()
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('waits for list data and clamps the offset after a shorter result', () => {
    window.history.replaceState({}, '', '/groups/grp-1/expenses/exp-1')
    setPageScroll(800, 2000)
    captureExpenseEditScroll('grp-1', 'exp-1')

    const { rerender } = renderHook(
      ({ ready }) => useRestoreExpenseEditScroll(ready, 'grp-1'),
      { initialProps: { ready: false } },
    )
    expect(nextFrame).toBeUndefined()

    setPageScroll(0, 900)
    rerender({ ready: true })
    renderNextFrame()
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 400,
      behavior: 'auto',
    })
  })

  it('restores the global feed and ignores an edit flow left for another page', () => {
    window.history.replaceState(
      {},
      '',
      '/expenses?q=dinner&expenseId=exp-1&expenseGroupId=grp-1',
    )
    setPageScroll(600, 1600)
    captureExpenseEditScroll('grp-1', 'exp-1', '/expenses?q=dinner')
    renderHook(() => useRestoreExpenseEditScroll(true))
    renderNextFrame()
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    })

    captureExpenseEditScroll('grp-1', 'exp-1', '/expenses?q=dinner')
    discardExpenseEditScrollOutside('/account/settings')
    vi.mocked(window.scrollTo).mockClear()
    renderHook(() => useRestoreExpenseEditScroll(true))
    expect(nextFrame).toBeUndefined()
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('restores the activity list after returning from edit', () => {
    window.history.replaceState(
      {},
      '',
      '/groups/grp-1/activity?expenseId=exp-1',
    )
    setPageScroll(700, 2000)
    captureExpenseEditScroll('grp-1', 'exp-1', '/groups/grp-1/activity')

    window.history.replaceState(
      {},
      '',
      '/groups/grp-1/activity?expenseId=exp-1',
    )
    renderHook(() => useRestoreExpenseEditScroll(true, 'grp-1'))
    renderNextFrame()
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 700,
      behavior: 'auto',
    })
  })
})
