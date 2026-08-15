import { afterEach, describe, expect, it, vi } from 'vitest'

import { render } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  updateServiceWorker: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: {
    onRegisteredSW?: (
      url: string,
      registration: ServiceWorkerRegistration,
    ) => void
  }) => {
    options.onRegisteredSW?.('/sw.js', {
      update: vi.fn(),
    } as unknown as ServiceWorkerRegistration)
    return {
      needRefresh: [true, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: mocks.updateServiceWorker,
    }
  },
}))

vi.mock('@/lib/pwa-update-checks', () => ({
  subscribeServiceWorkerUpdateChecks: mocks.subscribe,
}))

import { PwaRegister } from '@/components/pwa-register'

describe('PwaRegister', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reloads when a waiting worker is ready and subscribes to update checks', () => {
    render(<PwaRegister />)
    expect(mocks.subscribe).toHaveBeenCalledOnce()
    expect(mocks.updateServiceWorker).toHaveBeenCalledWith(true)
  })
})
