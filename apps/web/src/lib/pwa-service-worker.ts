export type PwaServiceWorkerContainer = Pick<
  ServiceWorkerContainer,
  'controller' | 'register' | 'addEventListener' | 'removeEventListener'
>

/**
 * Native registration kept behind an injectable boundary for lifecycle tests.
 * `updateViaCache: 'none'` asks the server for the worker script on every
 * update check so byte-change detection never serves a cached worker.
 */
export function registerPwaServiceWorker(
  container: PwaServiceWorkerContainer,
): Promise<ServiceWorkerRegistration> {
  return container.register('/sw.js', { scope: '/', updateViaCache: 'none' })
}
