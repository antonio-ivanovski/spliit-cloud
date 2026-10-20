import { useRef, useState } from 'react'

/**
 * Owns one durable request id for a logical create and closes the small window
 * before React can render an `isPending`/`isSubmitting` disabled state.
 */
export function useIdempotentCreate(restoredRequestId?: string) {
  const restoredUsed = useRef(false)
  const getRequestId = () =>
    !restoredUsed.current && restoredRequestId
      ? restoredRequestId
      : requestIdRef.current
  const [requestIdRef] = useState(() => ({ current: crypto.randomUUID() }))
  const inFlightRef = useRef(false)

  async function run<T>(
    create: (requestId: string) => Promise<T>,
  ): Promise<T | null> {
    if (inFlightRef.current) return null
    inFlightRef.current = true
    try {
      const result = await create(getRequestId())
      restoredUsed.current = true
      requestIdRef.current = crypto.randomUUID()
      return result
    } finally {
      inFlightRef.current = false
    }
  }

  function reset() {
    inFlightRef.current = false
    restoredUsed.current = true
    requestIdRef.current = crypto.randomUUID()
  }

  return { run, reset, getRequestId }
}
