import { Schema } from 'effect'

/**
 * Swap input failed validation (unknown/identical/custom currency, non-positive
 * custom rate). Maps to BAD_REQUEST at the tRPC boundary.
 */
export class SwapValidationError extends Schema.TaggedError<SwapValidationError>()(
  'SwapValidationError',
  {
    reason: Schema.String,
  },
) {}

/**
 * All provider lookups for the swap failed or a rate is missing for a planned
 * row. Carries per-key detail for the preview table; the procedure maps it to
 * BAD_GATEWAY (provider) so the UI can show row-level warnings instead of
 * failing the whole batch.
 */
export class SwapRateError extends Schema.TaggedError<SwapRateError>()(
  'SwapRateError',
  {
    reason: Schema.String,
    missingKeys: Schema.Array(Schema.String),
  },
) {}
