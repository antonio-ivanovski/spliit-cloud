/**
 * Hard limits shared between the API (which enforces them) and the web
 * (which renders their effects — caps, max sizes, etc.). Kept in
 * `@spliit/domain` so neither side hard-codes a magic number that can
 * drift from the other.
 *
 * Update both ends in lockstep: change the value here, then either
 * the API will use it (it imports from this file directly) or the web
 * will read it via its own import.
 */

/**
 * Maximum sample size the AI may surface for a single calibration
 * round. Capped so a calibration table always stays reviewable.
 */
export const BULK_CALIBRATION_SAMPLE_SIZE = 20

/**
 * Size of the expense pool the AI can inspect when choosing a
 * representative calibration sample. This is deliberately larger
 * than the displayed sample so the AI can pick informative examples.
 */
export const BULK_CALIBRATION_CANDIDATE_POOL_SIZE = 200

/**
 * The prompt asks the AI to finish calibration within this many rounds.
 * It is guidance only: neither the client nor API hard-stops a round.
 */
export const BULK_CALIBRATION_SUGGESTED_MAX_ROUNDS = 3

/**
 * How many expenses the AI sees per chunk when classifying the full
 * preview. Tuned so that the per-call prompt stays small enough for
 * 3.5-turbo and 4o-mini to respond deterministically.
 */
export const BULK_PREVIEW_CHUNK_SIZE = 25

/**
 * Upper bound on how many expenses a single bulk preview call will
 * process. Anything larger is rejected — the caller is expected to
 * narrow the target (e.g. by date range) before retrying.
 */
export const BULK_PREVIEW_MAX_TARGETS = 500

/**
 * Maximum number of expense changes allowed in a single bulk apply
 * call. Mirrored on the API; rejects larger inputs up-front.
 */
export const BULK_APPLY_HARD_LIMIT = 2000

/**
 * Char cap on every title fed to the AI in either calibration or
 * preview prompts.
 */
export const TITLE_CHAR_LIMIT = 40
