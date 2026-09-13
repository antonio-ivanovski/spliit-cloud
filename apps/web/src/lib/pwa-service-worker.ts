export type PwaServiceWorkerContainer = Pick<
  ServiceWorkerContainer,
  'controller' | 'register' | 'addEventListener' | 'removeEventListener'
>

/** Native registration kept behind an injectable boundary for lifecycle tests. */
export function registerPwaServiceWorker(
  container: PwaServiceWorkerContainer,
): Promise<ServiceWorkerRegistration> {
  return container.register('/sw.js', { scope: '/' })
}
