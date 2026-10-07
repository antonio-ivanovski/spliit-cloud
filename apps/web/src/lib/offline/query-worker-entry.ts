import {
  runOfflineWorkerQuery,
  type OfflineWorkerCancelMessage,
  type OfflineWorkerRequest,
  type OfflineWorkerResponse,
} from './query-worker'

// Worker entry: `self.onmessage` handles `{...request}` by running the
// Dexie-direct engine and posting back `{requestId, generation, ok,
// result}`. Requests carry query args + namespace/generation only; the
// worker opens Dexie itself, so histories never cross into it. Stale
// generations are still answered (callers discard by requestId/generation).
// `{type: 'cancel', requestId}` aborts an in-flight query between batches.
if (
  typeof self !== 'undefined' &&
  typeof (self as { postMessage?: unknown }).postMessage === 'function'
) {
  const scope = self as unknown as {
    onmessage:
      | ((
          event: MessageEvent<
            OfflineWorkerRequest | OfflineWorkerCancelMessage
          >,
        ) => void)
      | null
  }
  const postMessage = (
    self as unknown as {
      postMessage: (message: OfflineWorkerResponse) => void
    }
  ).postMessage.bind(self)
  const controllers = new Map<string, AbortController>()
  scope.onmessage = (
    event: MessageEvent<OfflineWorkerRequest | OfflineWorkerCancelMessage>,
  ) => {
    const message = event.data
    if (
      typeof (message as OfflineWorkerCancelMessage).type === 'string' &&
      (message as OfflineWorkerCancelMessage).type === 'cancel'
    ) {
      controllers
        .get((message as OfflineWorkerCancelMessage).requestId)
        ?.abort()
      return
    }
    const request = message as OfflineWorkerRequest
    const controller = new AbortController()
    controllers.set(request.requestId, controller)
    runOfflineWorkerQuery(request, { signal: controller.signal }).then(
      (result) => {
        controllers.delete(request.requestId)
        postMessage({
          requestId: request.requestId,
          generation: request.generation,
          ok: true,
          result,
        })
      },
      (error: unknown) => {
        controllers.delete(request.requestId)
        postMessage({
          requestId: request.requestId,
          generation: request.generation,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }
}
