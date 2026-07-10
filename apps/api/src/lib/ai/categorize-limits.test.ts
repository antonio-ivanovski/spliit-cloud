import {
  BULK_APPLY_HARD_LIMIT,
  BULK_CALIBRATION_CANDIDATE_POOL_SIZE,
  BULK_CALIBRATION_SAMPLE_SIZE,
  BULK_CALIBRATION_SUGGESTED_MAX_ROUNDS,
  BULK_PREVIEW_CHUNK_SIZE,
  BULK_PREVIEW_MAX_TARGETS,
  TITLE_CHAR_LIMIT,
} from '@spliit/domain'
import { describe, expect, it } from 'vitest'

describe('AI shared limits', () => {
  it('exposes bounded values', () => {
    expect(TITLE_CHAR_LIMIT).toBeGreaterThan(0)
    expect(BULK_PREVIEW_CHUNK_SIZE).toBeGreaterThan(0)
    expect(BULK_PREVIEW_MAX_TARGETS).toBeGreaterThan(BULK_PREVIEW_CHUNK_SIZE)
    expect(BULK_CALIBRATION_SAMPLE_SIZE).toBeGreaterThan(0)
    expect(BULK_CALIBRATION_CANDIDATE_POOL_SIZE).toBeGreaterThanOrEqual(
      BULK_CALIBRATION_SAMPLE_SIZE,
    )
    expect(BULK_CALIBRATION_SUGGESTED_MAX_ROUNDS).toBeGreaterThanOrEqual(1)
    expect(BULK_APPLY_HARD_LIMIT).toBeGreaterThanOrEqual(
      BULK_PREVIEW_MAX_TARGETS,
    )
  })
})
