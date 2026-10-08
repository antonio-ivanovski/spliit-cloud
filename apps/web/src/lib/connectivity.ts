import { isNetworkError } from '@/lib/network-error'
import { getDefaultConnectivityStore } from '@/lib/offline/connectivity'

export function reportNetworkFailure(error?: unknown) {
  if (error !== undefined && !isNetworkError(error)) return
  getDefaultConnectivityStore().reportNetworkFailure(
    error ?? new TypeError('Failed to fetch'),
  )
}

export function reportNetworkSuccess() {
  getDefaultConnectivityStore().reportNetworkSuccess()
}

export function hasFetchNetworkFailure() {
  const snapshot = getDefaultConnectivityStore().getSnapshot()
  return snapshot.transport === 'unreachable' || snapshot.serverFailure !== null
}

export function subscribeConnectivity(listener: () => void) {
  return getDefaultConnectivityStore().subscribe(listener)
}

export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    const response = await fetch(input, init)
    if (response.status >= 500) {
      getDefaultConnectivityStore().reportServerResponse(response.status)
    } else {
      reportNetworkSuccess()
      getDefaultConnectivityStore().clearServerFailure()
    }
    return response
  } catch (error) {
    reportNetworkFailure(error)
    throw error
  }
}

export function resetConnectivityForTests() {
  getDefaultConnectivityStore().resetForTests()
}
