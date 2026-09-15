import { describe, expect, it, vi } from 'vitest'

import {
  registerPwaServiceWorker,
  type PwaServiceWorkerContainer,
} from './pwa-service-worker'

describe('registerPwaServiceWorker', () => {
  it('registers the generated worker with app scope', async () => {
    const registration = {} as ServiceWorkerRegistration
    const register = vi.fn().mockResolvedValue(registration)
    const container = { register } as unknown as PwaServiceWorkerContainer

    await expect(registerPwaServiceWorker(container)).resolves.toBe(
      registration,
    )
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })
})
