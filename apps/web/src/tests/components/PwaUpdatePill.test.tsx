import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PwaUpdateSnapshot } from '@/lib/pwa-update-manager'
import { act, render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => {
  let snapshot: PwaUpdateSnapshot = { status: 'hidden' }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    retry: vi.fn(),
    dismissFailure: vi.fn(),
    setSnapshot: (next: PwaUpdateSnapshot) => {
      snapshot = next
      listeners.forEach((listener) => listener())
    },
  }
})

vi.mock('@/lib/pwa-update-manager', () => ({
  getPwaUpdateManager: () => mocks,
}))

import { PwaUpdatePill } from '@/components/pwa-update-pill'

describe('PwaUpdatePill', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mocks.setSnapshot({ status: 'hidden' })
  })

  it('renders nothing during normal update work', () => {
    const { container } = render(<PwaUpdatePill />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers retry and dismissal only after a failure', async () => {
    mocks.setSnapshot({ status: 'failed', dismissed: false })
    const { user } = render(<PwaUpdatePill />)

    expect(screen.getByRole('status')).toHaveTextContent(
      "Spliit couldn't apply the update.",
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(mocks.retry).toHaveBeenCalledOnce()
    expect(mocks.dismissFailure).toHaveBeenCalledOnce()
  })

  it('hides a dismissed failure', () => {
    act(() => mocks.setSnapshot({ status: 'failed', dismissed: true }))
    const { container } = render(<PwaUpdatePill />)
    expect(container).toBeEmptyDOMElement()
  })
})
