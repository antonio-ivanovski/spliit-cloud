import { isNetworkError } from '@/lib/network-error'

type Listener = () => void

const listeners = new Set<Listener>()
let fetchFailed = false

function emit() {
  for (const listener of listeners) listener()
}

export function reportNetworkFailure(error?: unknown) {
  if (error !== undefined && !isNetworkError(error)) return
  if (fetchFailed) return
  fetchFailed = true
  emit()
}

export function reportNetworkSuccess() {
  if (!fetchFailed) return
  fetchFailed = false
  emit()
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
    // A 5xx response means the request reached *something* but the API itself
    // is failing (crashed container, broken deploy, overloaded DB). The user
    // is online — the server is not. Latch this the same way as a thrown
    // connectivity error so the UI can blame the server instead of the user.
    // 4xx responses are honest answers from a working API: clear the latch.
    if (response.status >= 500) {
      reportNetworkFailure()
      return response
    }
    reportNetworkSuccess()
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
}
