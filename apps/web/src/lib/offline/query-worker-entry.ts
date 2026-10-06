import {
  runOfflineWorkerQuery,
  type OfflineWorkerRequest,
  type OfflineWorkerResponse,
} from './query-worker'

// Worker entry: `self.onmessage` handles `{...request}` and posts back
// `{requestId, generation, ok, result}`. Stale generations are still answered
// (callers discard by requestId/generation); the cache itself is fenced above.
if (
  typeof self !== 'undefined' &&
  typeof (self as { postMessage?: unknown }).postMessage === 'function'
) {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<OfflineWorkerRequest>) => void) | null
  }
  scope.onmessage = (event: MessageEvent<OfflineWorkerRequest>) => {
    const request = event.data
    try {
      const result = runOfflineWorkerQuery(request)
      ;(
        self as unknown as {
          postMessage: (message: OfflineWorkerResponse) => void
        }
      ).postMessage({
        requestId: request.requestId,
        generation: request.generation,
        ok: true,
        result,
      })
    } catch (error) {
      ;(
        self as unknown as {
          postMessage: (message: OfflineWorkerResponse) => void
        }
      ).postMessage({
        requestId: request.requestId,
        generation: request.generation,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
