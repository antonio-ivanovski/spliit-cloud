import { afterEach, describe, expect, it, vi } from 'vitest'

import { fireEvent, render } from '@/test/test-utils'

let mockNavigating = false
let mockMutating = 0

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (options?: {
    select?: (state: { isLoading: boolean }) => boolean
  }) =>
    options?.select
      ? options.select({ isLoading: mockNavigating })
      : { isLoading: mockNavigating },
}))

vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useIsMutating: () => mockMutating,
}))

import {
  PwaUpdateCompositionGuard,
  PwaUpdateMutationGuard,
  PwaUpdateNavigationGuard,
} from '@/components/pwa-update-guards'
import {
  getPwaUpdateBlockerCount,
  resetPwaUpdateBlockersForTests,
} from '@/lib/pwa-update-blockers'

describe('PwaUpdateGuards', () => {
  afterEach(() => {
    resetPwaUpdateBlockersForTests()
    mockNavigating = false
    mockMutating = 0
  })

  it('blocks during IME composition', () => {
    render(<PwaUpdateCompositionGuard />)
    fireEvent.compositionStart(document)
    expect(getPwaUpdateBlockerCount()).toBe(1)
    fireEvent.compositionEnd(document)
    expect(getPwaUpdateBlockerCount()).toBe(0)
  })

  it('blocks while a route transition is pending', () => {
    mockNavigating = true
    const { rerender } = render(<PwaUpdateNavigationGuard />)
    expect(getPwaUpdateBlockerCount()).toBe(1)
    mockNavigating = false
    rerender(<PwaUpdateNavigationGuard />)
    expect(getPwaUpdateBlockerCount()).toBe(0)
  })

  it('blocks while any mutation is in flight', () => {
    mockMutating = 2
    const { rerender } = render(<PwaUpdateMutationGuard />)
    expect(getPwaUpdateBlockerCount()).toBe(1)
    mockMutating = 0
    rerender(<PwaUpdateMutationGuard />)
    expect(getPwaUpdateBlockerCount()).toBe(0)
  })
})
