import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PwaUpdatePill } from '@/components/pwa-update-pill'
import type {
  PwaUpdateManager,
  PwaUpdateSnapshot,
} from '@/lib/pwa-update-manager'
import {
  makePwaUpdateService,
  type PwaUpdateService,
} from '@/lib/services/pwa-updates'
import { act, render, screen } from '@/test/test-utils'

// Authoring gate (test-audit): this file owns the pill's presentation binding
// (failure renders Retry/Dismiss, dismissal hides, actions dispatch to the
// update service). Manager state-machine behavior is owned by
// pwa-update-manager.test.ts; the service gate by pwa-updates.test.ts. The
// stub manager below is the service's production constructor parameter — not
// a preservation of the deleted module singleton.

function stubManager() {
  let snapshot: PwaUpdateSnapshot = { status: 'hidden' }
  const listeners = new Set<() => void>()
  return {
    manager: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      retry: vi.fn(),
      dismissFailure: vi.fn(),
      dispose: vi.fn(),
    } as unknown as PwaUpdateManager,
    setSnapshot: (next: PwaUpdateSnapshot) => {
      snapshot = next
      listeners.forEach((listener) => listener())
    },
  }
}

describe('PwaUpdatePill', () => {
  const services: PwaUpdateService[] = []

  async function renderPill(initial?: PwaUpdateSnapshot) {
    const stub = stubManager()
    if (initial) stub.setSnapshot(initial)
    const service = makePwaUpdateService({
      createManager: () => stub.manager,
      checkForUpdate: () => Promise.resolve(null),
      isVisible: () => true,
    })
    services.push(service)
    await Effect.runPromise(service.start)
    const rendered = render(<PwaUpdatePill service={service} />)
    return { stub, service, ...rendered }
  }

  afterEach(async () => {
    vi.clearAllMocks()
    while (services.length > 0) {
      const service = services.pop()
      if (service) {
        await Effect.runPromise(service.dispose).catch(() => undefined)
      }
    }
  })

  it('renders nothing during normal update work', async () => {
    const { container } = await renderPill()
    expect(container).toBeEmptyDOMElement()
  })

  it('offers retry and dismissal only after a failure', async () => {
    const { stub, user } = await renderPill()
    act(() => stub.setSnapshot({ status: 'failed', dismissed: false }))

    expect(screen.getByRole('status')).toHaveTextContent(
      "Spliit couldn't apply the update.",
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(stub.manager.retry).toHaveBeenCalledOnce()
    expect(stub.manager.dismissFailure).toHaveBeenCalledOnce()
  })

  it('hides a dismissed failure', async () => {
    const { container } = await renderPill({
      status: 'failed',
      dismissed: true,
    })
    expect(container).toBeEmptyDOMElement()
  })
})
