import { afterEach, describe, expect, it, vi } from 'vitest'

import { act, render, screen } from '@/test/test-utils'

import {
  BulkCategorizeProgressScene,
  receiptBottomClip,
} from './bulk-categorize-progress-scene'

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => state === 'hidden',
  })
}

describe('BulkCategorizeProgressScene', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setVisibility('visible')
  })

  it('keeps Bill, seven printed receipts, and five layered trays in one scene', () => {
    render(<BulkCategorizeProgressScene />)
    const scene = screen.getByTestId('bill-sort-scene')
    expect(scene).toHaveAttribute('aria-hidden', 'true')
    expect(
      scene.querySelector('[data-mascot-sorting-face]'),
    ).toBeInTheDocument()
    expect(scene.querySelectorAll('.bill-sort-scene__receipt')).toHaveLength(1)
    expect(
      scene.querySelectorAll(
        '.bill-sort-scene__stack-sheet .bill-sort-scene__receipt-heading',
      ),
    ).toHaveLength(6)
    expect(
      scene.querySelectorAll('.bill-sort-scene__stack-sheet--front'),
    ).toHaveLength(1)
    expect(
      scene.querySelectorAll('.bill-sort-scene__stack-sheet--middle'),
    ).toHaveLength(1)
    expect(
      scene.querySelectorAll('.bill-sort-scene__stack-sheet--back'),
    ).toHaveLength(1)
    expect(
      scene.querySelectorAll('.bill-sort-scene__stack-sheet--rear'),
    ).toHaveLength(1)
    expect(
      scene.querySelectorAll('.bill-sort-scene__stack-sheet--hidden'),
    ).toHaveLength(2)
    expect(
      scene.querySelector<HTMLElement>('.bill-sort-scene__receipt')?.style
        .transform,
    ).toContain('translate3d')
    expect(
      scene.querySelector('.bill-sort-scene__receipt-heading'),
    ).toBeInTheDocument()
    expect(
      scene.querySelector('.bill-sort-scene__receipt-fold'),
    ).toBeInTheDocument()
    expect(scene.querySelectorAll('.bill-sort-scene__tray-front')).toHaveLength(
      5,
    )
    expect(scene.querySelectorAll('.bill-sort-scene__tray-filed')).toHaveLength(
      10,
    )
    expect(
      scene.querySelector('.bill-sort-scene__incoming'),
    ).toBeInTheDocument()
    expect(
      scene.querySelector('.bill-sort-scene__receipt .bill-sort-scene__clue'),
    ).toBeNull()
    expect(scene.querySelector('.bill-sort-scene__idea')).toBeInTheDocument()
  })

  it('runs the shared scene clock only while visible and cancels it on unmount', async () => {
    let frame: FrameRequestCallback | undefined
    const request = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frame = callback
        return 3
      })
    const cancel = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {})
    setVisibility('visible')

    const { unmount } = render(<BulkCategorizeProgressScene />)
    expect(request).toHaveBeenCalled()
    await act(async () => frame?.(100))
    const receipt = screen
      .getByTestId('bill-sort-scene')
      .querySelector<HTMLElement>('.bill-sort-scene__receipt')
    expect(receipt?.style.transform).toContain('translate3d')

    setVisibility('hidden')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(cancel).toHaveBeenCalledWith(3)
    const requestsWhileHidden = request.mock.calls.length
    await act(async () => frame?.(150))
    expect(request).toHaveBeenCalledTimes(requestsWhileHidden)

    setVisibility('visible')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(request).toHaveBeenCalledTimes(requestsWhileHidden + 1)
    unmount()
    expect(cancel).toHaveBeenCalledWith(3)
  })

  it('contains animation-frame errors without removing surrounding progress', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    let frame: FrameRequestCallback | undefined
    const request = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frame = callback
        return 7
      })
    const cancel = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {})
    render(
      <>
        <span>Processing expenses</span>
        <BulkCategorizeProgressScene />
      </>,
    )
    vi.spyOn(Math, 'sin').mockImplementationOnce(() => {
      throw new Error('Animation failure')
    })

    await act(async () => frame?.(48))

    expect(screen.getByText('Processing expenses')).toBeInTheDocument()
    expect(screen.queryByTestId('bill-sort-scene')).not.toBeInTheDocument()
    expect(cancel).toHaveBeenCalledWith(7)
    expect(report).toHaveBeenCalledWith(
      'Bill sorting animation failed',
      expect.any(Error),
    )
    const scheduled = request.mock.calls.length
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(request).toHaveBeenCalledTimes(scheduled)
  })

  it('reaches for the stack before moving the receipt and settles it in a tray', async () => {
    let frame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<BulkCategorizeProgressScene />)
    const scene = screen.getByTestId('bill-sort-scene')
    const receipt = scene.querySelector<HTMLElement>(
      '.bill-sort-scene__receipt',
    )
    const originalTitle = receipt?.querySelector(
      '.bill-sort-scene__receipt-heading',
    )?.textContent
    const queuedTitle = scene.querySelector(
      '.bill-sort-scene__stack-sheet--front .bill-sort-scene__receipt-heading',
    )?.textContent
    const queuedSheet = scene.querySelector<HTMLElement>(
      '.bill-sort-scene__stack-sheet--front',
    )

    await act(async () => {
      for (let time = 48; time <= 520; time += 48) frame?.(time)
    })
    expect(
      scene.querySelector('[data-mascot-sorting-face="catching"]'),
    ).toBeInTheDocument()
    expect(receipt?.style.transform).toContain('translate3d')
    expect(receipt?.style.transform).not.toContain('rotate(')
    expect(
      scene.querySelector<HTMLElement>('.bill-sort-scene__idea')?.style.opacity,
    ).toBe('0')
    expect(
      scene.querySelectorAll('.bill-sort-scene__stack-sheet'),
    ).toHaveLength(6)

    await act(async () => {
      for (let time = 568; time <= 1600; time += 48) frame?.(time)
    })
    expect(
      Number(
        scene.querySelector<HTMLElement>('.bill-sort-scene__idea')?.style
          .opacity,
      ),
    ).toBeGreaterThan(0)
    expect(
      receipt?.querySelector('.bill-sort-scene__receipt-heading')?.textContent,
    ).toBe(originalTitle)
    expect(receipt?.style.transform).not.toContain('rotate(')
    await act(async () => {
      for (let time = 1648; time <= 3000; time += 48) frame?.(time)
    })
    expect(
      scene.querySelector('.bill-sort-scene__tray[data-active="true"]'),
    ).toBeInTheDocument()
    expect(
      scene.querySelector('[data-mascot-sorting-face="filing"]'),
    ).toBeInTheDocument()
    expect(
      receipt?.querySelector('.bill-sort-scene__receipt-heading')?.textContent,
    ).toBe(originalTitle)
    expect(receipt?.style.clipPath).toContain('inset(')
    expect(receipt?.style.transform).not.toContain('rotate(')
    await act(async () => {
      for (let time = 3048; time <= 3800; time += 48) frame?.(time)
    })
    expect(
      queuedSheet?.querySelector('.bill-sort-scene__receipt-heading')
        ?.textContent,
    ).toBe(queuedTitle)
    expect(scene.querySelector('.bill-sort-scene__receipt')).toBe(queuedSheet)
    expect(
      scene.querySelectorAll('.bill-sort-scene__stack-sheet'),
    ).toHaveLength(6)
    expect(
      scene.querySelectorAll('.bill-sort-scene__stack-sheet--hidden'),
    ).toHaveLength(2)
    const newBottomSheet = scene.querySelector<HTMLElement>(
      '.bill-sort-scene__stack-sheet--hidden',
    )
    const followingSheet = scene.querySelector<HTMLElement>(
      '.bill-sort-scene__stack-sheet--front',
    )
    await act(async () => {
      for (let time = 3848; time <= 7100; time += 48) frame?.(time)
    })
    expect(scene.querySelector('.bill-sort-scene__receipt')).toBe(
      followingSheet,
    )
    expect(newBottomSheet).toHaveClass('bill-sort-scene__stack-sheet--hidden')
  })

  it('keeps the active receipt unchanged when the title list changes, then uses the new list', async () => {
    let frame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { rerender } = render(
      <BulkCategorizeProgressScene
        titles={[
          { category: 'groceries', title: 'Old market' },
          { category: 'dining', title: 'Old cafe' },
        ]}
      />,
    )
    const scene = screen.getByTestId('bill-sort-scene')
    const receipt = scene.querySelector<HTMLElement>(
      '.bill-sort-scene__receipt',
    )
    const queuedSheet = scene.querySelector<HTMLElement>(
      '.bill-sort-scene__stack-sheet--front',
    )
    const initialTitle = receipt?.textContent
    const queuedTitle = scene.querySelector(
      '.bill-sort-scene__stack-sheet--front .bill-sort-scene__receipt-heading',
    )?.textContent
    await act(async () => {
      for (let time = 48; time <= 1600; time += 48) frame?.(time)
    })
    rerender(
      <BulkCategorizeProgressScene
        titles={[
          { category: 'movies', title: 'New cinema' },
          { category: 'plane', title: 'New flight' },
        ]}
      />,
    )
    expect(receipt?.textContent).toBe(initialTitle)
    await act(async () => {
      for (let time = 1648; time <= 3800; time += 48) frame?.(time)
    })
    expect(scene.querySelector('.bill-sort-scene__receipt')).toBe(queuedSheet)
    expect(queuedSheet?.textContent).toContain(queuedTitle)
    expect(
      scene.querySelector('.bill-sort-scene__stack-sheet--hidden')?.textContent,
    ).toMatch(/New cinema|New flight/)
    for (let cycle = 0; cycle < 6; cycle++) {
      const start = 3848 + cycle * 3456
      await act(async () => {
        for (let time = start; time <= start + 3408; time += 48) frame?.(time)
      })
    }
    expect(
      scene.querySelector('.bill-sort-scene__receipt')?.textContent,
    ).toMatch(/New cinema|New flight/)
  })

  it('clips a filed receipt before its lower edge could show beneath the tray', () => {
    expect(receiptBottomClip(190, 96, 1, 304)).toBe(0)
    const clip = receiptBottomClip(230, 96, 0.87, 304)
    expect(clip).toBeGreaterThan(0)
    expect(clip).toBeLessThan(96)
  })
})
