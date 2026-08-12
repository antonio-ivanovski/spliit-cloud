import { afterEach, describe, expect, it } from 'vitest'

import { BillCharacter } from '@/components/mascot/characters/bill/bill-character'
import { act, render } from '@/test/test-utils'

const CREEPY_GRIN = 'M55 70Q70 88 85 70'

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
}

describe('BillCharacter', () => {
  afterEach(() => {
    setVisibility('visible')
  })

  it('remounts the idle loop after the page becomes visible again', () => {
    const { container } = render(<BillCharacter />)
    const svg = container.querySelector('[data-mascot-reaction="idle"]')
    expect(svg).toBeTruthy()
    const cycle = svg?.getAttribute('data-mascot-cycle')

    setVisibility('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(
      container
        .querySelector('[data-mascot-reaction="idle"]')
        ?.getAttribute('data-mascot-cycle'),
    ).toBe(cycle)

    setVisibility('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(
      container
        .querySelector('[data-mascot-reaction="idle"]')
        ?.getAttribute('data-mascot-cycle'),
    ).not.toBe(cycle)
  })

  it('remounts the idle loop when the window regains focus', () => {
    const { container } = render(<BillCharacter />)
    const cycle = container
      .querySelector('[data-mascot-reaction="idle"]')
      ?.getAttribute('data-mascot-cycle')

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(
      container
        .querySelector('[data-mascot-reaction="idle"]')
        ?.getAttribute('data-mascot-cycle'),
    ).not.toBe(cycle)
  })

  it('uses a closed smile for success instead of an open grin', () => {
    const { container } = render(<BillCharacter reaction="success" />)
    expect(container.innerHTML).not.toContain(CREEPY_GRIN)
    expect(container.innerHTML).toContain('M57 76Q70 88 83 76')
    expect(container.querySelector('[data-mascot-fx="success"]')).toBeTruthy()
    expect(container.querySelector('[data-mascot-rain="true"]')).toBeTruthy()
    expect(container.querySelector('[data-mascot-sparkles="true"]')).toBeNull()
    expect(container.querySelector('[data-mascot-fx="celebrate"]')).toBeNull()
  })

  it('marks celebrate with a clap, coins, and sparkles', () => {
    const { container } = render(<BillCharacter reaction="celebrate" />)
    expect(container.querySelector('[data-mascot-fx="celebrate"]')).toBeTruthy()
    expect(container.querySelector('[data-mascot-clap="true"]')).toBeTruthy()
    expect(
      container.querySelector('[data-mascot-sparkles="true"]'),
    ).toBeTruthy()
    expect(container.querySelector('[data-mascot-fx="success"]')).toBeNull()
    expect(container.innerHTML).not.toContain(CREEPY_GRIN)
  })

  it('shows a waving stick arm only during welcome', () => {
    const { container, rerender } = render(<BillCharacter reaction="welcome" />)
    expect(container.querySelector('[data-mascot-arm="wave"]')).toBeTruthy()
    rerender(<BillCharacter reaction="idle" />)
    expect(container.querySelector('[data-mascot-arm="wave"]')).toBeNull()
    expect(container.querySelector('[data-mascot-arm]')).toBeNull()
  })

  it('paints the stick arm behind the receipt body', () => {
    const { container } = render(<BillCharacter reaction="welcome" />)
    const arm = container.querySelector('[data-mascot-arm="wave"]')
    const body = [...container.querySelectorAll('path')].find((path) =>
      path.getAttribute('d')?.startsWith('M70 14'),
    )
    expect(arm).toBeTruthy()
    expect(body).toBeTruthy()
    expect(
      arm!.compareDocumentPosition(body!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps every reaction on mascot tokens instead of UI primary', () => {
    const reactions = [
      'idle',
      'thinking',
      'success',
      'celebrate',
      'acknowledge',
      'welcome',
      'failure',
    ] as const

    for (const reaction of reactions) {
      const { container, unmount } = render(
        <BillCharacter reaction={reaction} />,
      )
      expect(container.innerHTML, reaction).not.toContain('hsl(var(--primary)')
      expect(container.innerHTML, reaction).not.toContain('hsl(var(--card)')
      unmount()
    }
  })

  it('keeps idle print colors when the speed-dial is open', () => {
    const { container } = render(<BillCharacter open />)
    expect(container.innerHTML).toContain('stroke="hsl(var(--mascot-stroke))"')
    expect(container.innerHTML).toContain('stroke="hsl(var(--mascot-accent))"')
    expect(container.querySelector('circle[r="53"]')).toBeNull()
  })

  it('paints the receipt with dedicated opaque paper tokens', () => {
    const { container } = render(<BillCharacter />)
    expect(container.innerHTML).toContain('--mascot-paper')
    expect(container.innerHTML).toContain('--mascot-paper-edge')
    expect(container.innerHTML).toContain('--mascot-stroke')
    expect(container.innerHTML).toContain('--mascot-accent')
    expect(container.innerHTML).toContain('--mascot-ink')
    expect(container.innerHTML).toContain('stroke="hsl(var(--mascot-stroke))"')
    expect(container.innerHTML).not.toContain(
      'stopColor="hsl(var(--background))"',
    )
    expect(container.innerHTML).not.toContain(
      'stopColor="hsl(var(--primary) / 0.14)"',
    )
    expect(container.innerHTML).not.toContain('hsl(var(--primary)')
  })

  it('marks acknowledge with a stick-arm toss into the trash', () => {
    const { container, rerender } = render(
      <BillCharacter reaction="acknowledge" />,
    )
    expect(
      container.querySelector('[data-mascot-fx="acknowledge"]'),
    ).toBeTruthy()
    expect(container.querySelector('[data-mascot-arm="toss"]')).toBeTruthy()
    rerender(<BillCharacter reaction="idle" />)
    expect(container.querySelector('[data-mascot-fx="acknowledge"]')).toBeNull()
    expect(container.querySelector('[data-mascot-arm]')).toBeNull()
  })
})
