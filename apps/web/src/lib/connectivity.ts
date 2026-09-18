import { isNetworkError } from '@/lib/network-error'
import { getDefaultConnectivityStore } from '@/lib/offline/connectivity'

type Listener = () => void

const listeners = new Set<Listener>()
let fetchFailed = false

function emit() {
  for (const listener of listeners) listener()
}

function sharedStore() {
  try {
    return getDefaultConnectivityStore()
  } catch {
    return null
  }
}

export function reportNetworkFailure(error?: unknown) {
  if (error !== undefined && !isNetworkError(error)) return
  if (!fetchFailed) {
    fetchFailed = true
    emit()
  }
  // Mirror into the shared transport store so `useOnlineStatus()` (a
  // projection of that store) observes the same latch without owning one.
  try {
    sharedStore()?.reportNetworkFailure(
      error ?? new TypeError('Failed to fetch'),
    )
  } catch {
    // Ignore mirror failures.
  }
}

export function reportNetworkSuccess() {
  if (fetchFailed) {
    fetchFailed = false
    emit()
  }
  try {
    sharedStore()?.reportNetworkSuccess()
  } catch {
    // Ignore mirror failures.
  }
}

export function hasFetchNetworkFailure() {
  return fetchFailed
}

export function subscribeConnectivity(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    const response = await fetch(input, init)
    // HTTP 5xx is a server response, not proof of offline: record it
    // distinctly but clear the unreachable latch (the server answered).
    // HTTP 4xx (401 anonymous, 403/404 guards) is normal: the server
    // answered, so treat as success and clear any stale failure.
    if (response.status >= 500 && response.status <= 599) {
      try {
        sharedStore()?.reportServerResponse(response.status)
      } catch {
        // Ignore.
      }
    } else {
      reportNetworkSuccess()
      try {
        sharedStore()?.clearServerFailure()
      } catch {
        // Ignore.
      }
    }
    return response
  } catch (error) {
    reportNetworkFailure(error)
    throw error
  }
}

/** Test-only: drop the fetch-failure latch between cases. */
export function resetConnectivityForTests() {
  fetchFailed = false
  emit()
  try {
    sharedStore()?.resetForTests()
  } catch {
    // Ignore.
  }
}
