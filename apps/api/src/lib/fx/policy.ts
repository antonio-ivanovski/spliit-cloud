import { Schedule } from 'effect'

// Same budget as the engine's historical retry loop (250ms base, 3 attempts):
// with only two retries the backoff never reaches the old 3s cap, so no cap
// combinator is needed.
export const FX_MAX_ATTEMPTS = 3
export const FX_RETRY_BASE_MS = 250

/** Jittered exponential backoff for transient FX failures. */
export const fxRetrySchedule = Schedule.jittered(
  Schedule.exponential(`${FX_RETRY_BASE_MS} millis`),
)
