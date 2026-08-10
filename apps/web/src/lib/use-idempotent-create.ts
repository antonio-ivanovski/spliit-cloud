import { useCallback, useRef } from 'react'

/**
 * Owns one durable request id for a logical create and closes the small window
 * before React can render an `isPending`/`isSubmitting` disabled state.
 */
export function useIdempotentCreate() {
  const requestIdRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)
  requestIdRef.current ??= crypto.randomUUID()

  const run = useCallback(
    async <T>(create: (requestId: string) => Promise<T>): Promise<T | null> => {
      if (inFlightRef.current) return null
      inFlightRef.current = true
      try {
        const result = await create(requestIdRef.current!)
        requestIdRef.current = crypto.randomUUID()
        return result
      } finally {
        inFlightRef.current = false
      }
    },
    [],
  )

  const reset = useCallback(() => {
    inFlightRef.current = false
    requestIdRef.current = crypto.randomUUID()
  }, [])

  return { run, reset }
}
