import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getErrorScrollBehavior,
  resolveErrorAnchorKey,
  scrollErrorElementIntoView,
  scrollToAnchoredError,
} from './error-scroll'

function stubLayout({
  top,
  height,
  scrollY = 100,
  innerHeight = 800,
  headerHeight = 60,
  actionBarHeight = 70,
}: {
  top: number
  height: number
  scrollY?: number
  innerHeight?: number
  headerHeight?: number
  actionBarHeight?: number
}) {
  Object.defineProperty(window, 'scrollY', { value: scrollY, writable: true })
  Object.defineProperty(window, 'innerHeight', {
    value: innerHeight,
    writable: true,
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  for (const node of document.querySelectorAll(
    '[data-app-header],[data-fixed-action-bar]',
  )) {
    node.remove()
  }
  const header = document.createElement('div')
  header.setAttribute('data-app-header', '')
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
    height: headerHeight,
  } as DOMRect)
  const actionBar = document.createElement('div')
  actionBar.setAttribute('data-fixed-action-bar', '')
  vi.spyOn(actionBar, 'getBoundingClientRect').mockReturnValue({
    height: actionBarHeight,
  } as DOMRect)
  document.body.append(header, actionBar)

  const element = document.createElement('div')
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top,
    height,
  } as DOMRect)
  document.body.append(element)
  return element
}

describe('resolveErrorAnchorKey', () => {
  it.each([
    ['paidFor', 'paidFor'],
    ['paidFor.0.shares', 'paidFor'],
    ['paidFor.root', 'paidFor'],
    ['splitMode', 'paidFor'],
    ['paidByList', 'paidByList'],
    ['paidByList.2.shares', 'paidByList'],
    ['paidBySplitMode', 'paidByList'],
    ['isMultiPayer', 'paidByList'],
    ['items', 'items'],
    ['items.0.title', 'items'],
    ['items.1.paidFor', 'items'],
    ['itemizedRemainder', 'items'],
    ['itemizedRemainder.paidFor', 'items'],
  ])('maps %s to %s', (path, key) => {
    expect(resolveErrorAnchorKey(path)).toBe(key)
  })

  it.each(['title', 'amount', 'conversionRate', 'exactAmount', 'expenseDay'])(
    'returns null for plain field %s',
    (path) => {
      expect(resolveErrorAnchorKey(path)).toBeNull()
    },
  )
})

describe('getErrorScrollBehavior', () => {
  it('returns smooth by default', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
    } as MediaQueryList)
    expect(getErrorScrollBehavior()).toBe('smooth')
  })

  it('returns auto with reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
    } as MediaQueryList)
    expect(getErrorScrollBehavior()).toBe('auto')
  })
})

describe('scrollErrorElementIntoView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('centers the element between header and action bar', () => {
    const element = stubLayout({ top: 500, height: 40 })
    scrollErrorElementIntoView(element, 'auto')
    // visible = 800 - 60 - 70 = 670; top = 100 + 500 - 60 - (670 - 40) / 2
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 225, behavior: 'auto' })
  })

  it('clamps to the top of the page', () => {
    const element = stubLayout({ top: -500, height: 40, scrollY: 0 })
    scrollErrorElementIntoView(element, 'auto')
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })
})

describe('scrollToAnchoredError', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  it('returns false without a matching anchor', () => {
    const root = document.createElement('form')
    document.body.append(root)
    expect(scrollToAnchoredError(root, 'paidFor', 'auto')).toBe(false)
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('prefers the row-error summary for root sum errors', () => {
    const root = document.createElement('form')
    root.innerHTML = `
      <div data-expense-error-anchor="paidFor">
        <div data-expense-row-errors>amount sum</div>
        <p role="alert">paidFor invalid</p>
      </div>`
    document.body.append(root)
    const summary = root.querySelector<HTMLElement>(
      '[data-expense-row-errors]',
    )!
    vi.spyOn(summary, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      height: 50,
    } as DOMRect)
    expect(scrollToAnchoredError(root, 'paidFor', 'auto')).toBe(true)
    expect(window.scrollTo).toHaveBeenCalled()
  })

  it('falls back to the alert message when no row summary renders', () => {
    const root = document.createElement('form')
    root.innerHTML = `
      <div data-expense-error-anchor="items">
        <p role="alert">items exceed amount</p>
      </div>`
    document.body.append(root)
    const message = root.querySelector<HTMLElement>('[role="alert"]')!
    vi.spyOn(message, 'getBoundingClientRect').mockReturnValue({
      top: 300,
      height: 20,
    } as DOMRect)
    expect(scrollToAnchoredError(root, 'items', 'auto')).toBe(true)
    expect(window.scrollTo).toHaveBeenCalled()
  })
})
