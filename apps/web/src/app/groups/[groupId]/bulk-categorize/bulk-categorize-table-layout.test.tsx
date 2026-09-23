import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CategorizeRow } from './bulk-categorize-table'

const virtualizerMock = vi.hoisted(() => ({
  estimates: [] as number[],
  measure: vi.fn(),
  measureElement: vi.fn(),
}))

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: (options: {
    count: number
    estimateSize: (index: number) => number
  }) => ({
    measure: virtualizerMock.measure,
    measureElement: virtualizerMock.measureElement,
    getTotalSize: () => {
      const size = options.estimateSize(0)
      virtualizerMock.estimates.push(size)
      return size * options.count
    },
    getVirtualItems: () => (options.count > 0 ? [{ index: 0, start: 0 }] : []),
  }),
}))

vi.mock('@/components/category-selector', () => ({
  CategorySelector: () => <button type="button">Category</button>,
}))

import { BulkCategorizeTable } from './bulk-categorize-table'

const row: CategorizeRow = {
  id: 'expense-1',
  title: 'Lunch',
  expenseDate: '2026-09-22',
  amount: 1200,
  currency: 'USD',
  categoryId: 'general',
  choices: [],
}

describe('bulk categorization table measurements', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    virtualizerMock.estimates.length = 0
    virtualizerMock.measure.mockClear()
    virtualizerMock.measureElement.mockClear()
  })

  it('uses desktop dimensions at first paint and remeasures when the layout changes', () => {
    let width = 900
    let onResize: (() => void) | undefined
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width, top: 100 }) as DOMRect,
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          onResize = callback
        }
        observe() {}
        disconnect() {}
      },
    )

    const props = {
      rows: [row],
      disabled: false,
      aiMinConfidence: 0.5,
      onChange: vi.fn(),
    }
    const view = render(<BulkCategorizeTable {...props} />)
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(virtualizerMock.estimates).toEqual([72])
    expect(screen.getByRole('listitem').firstElementChild).toHaveClass('grid')

    act(() => {
      width = 390
      onResize?.()
    })
    expect(virtualizerMock.estimates.at(-1)).toBe(180)
    expect(screen.getByRole('listitem').firstElementChild).toHaveClass(
      'space-y-3',
    )

    act(() => {
      width = 900
      onResize?.()
    })
    expect(virtualizerMock.estimates.at(-1)).toBe(72)
    expect(screen.getByRole('listitem').firstElementChild).toHaveClass('grid')
    expect(virtualizerMock.measureElement).toHaveBeenCalledWith(
      screen.getByRole('listitem'),
    )

    view.rerender(
      <BulkCategorizeTable
        {...props}
        rows={[
          {
            ...row,
            choices: [
              {
                categoryId: 'transportation',
                source: 'local',
                confidence: null,
              },
            ],
          },
        ]}
      />,
    )
    expect(virtualizerMock.estimates.at(-1)).toBe(76)
    expect(virtualizerMock.measure).toHaveBeenCalled()
  })
})
