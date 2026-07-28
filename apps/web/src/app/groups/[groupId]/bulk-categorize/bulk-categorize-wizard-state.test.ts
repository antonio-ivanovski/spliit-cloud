import { describe, expect, it } from 'vitest'

import {
  bulkCategorizeWizardReducer,
  initialBulkCategorizeWizardState,
} from './bulk-categorize-wizard-state'

describe('bulkCategorizeWizardReducer', () => {
  const sample = {
    expenseId: 'expense-1',
    title: 'Coffee',
    suggestedCategoryId: 'dining-out' as const,
    confidence: 'high' as const,
  }

  it('moves from intro through AI-ready calibration to preview', () => {
    const started = bulkCategorizeWizardReducer(
      initialBulkCategorizeWizardState,
      { type: 'START' },
    )
    const calibrated = bulkCategorizeWizardReducer(started, {
      type: 'CALIBRATION_RECEIVED',
      priorSelections: [],
      selections: [sample],
      ready: true,
    })
    const preview = bulkCategorizeWizardReducer(calibrated, {
      type: 'OPEN_PREVIEW',
    })

    expect(started.step).toBe('calibration')
    expect(calibrated.calibrationRound).toBe(1)
    expect(calibrated.calibrationReady).toBe(true)
    expect(preview.step).toBe('preview')
  })

  it('keeps reviewed corrections and supports another AI calibration', () => {
    const calibrated = bulkCategorizeWizardReducer(
      initialBulkCategorizeWizardState,
      {
        type: 'CALIBRATION_RECEIVED',
        priorSelections: [],
        selections: [sample],
        ready: false,
      },
    )
    const edited = bulkCategorizeWizardReducer(calibrated, {
      type: 'CALIBRATION_EDITED',
      expenseId: sample.expenseId,
      categoryId: 'groceries',
    })
    const next = bulkCategorizeWizardReducer(edited, {
      type: 'CALIBRATION_RECEIVED',
      priorSelections: [
        { expenseId: sample.expenseId, categoryId: 'groceries' },
      ],
      selections: [],
      ready: true,
    })

    expect(edited.calibrationEdits[sample.expenseId]).toBe('groceries')
    expect(next.priorSelections).toEqual([
      { expenseId: sample.expenseId, categoryId: 'groceries' },
    ])
    expect(next.calibrationRound).toBe(2)
    expect(next.calibrationReady).toBe(true)
  })

  it('edits and excludes preview rows before completing', () => {
    const withPreview = bulkCategorizeWizardReducer(
      { ...initialBulkCategorizeWizardState, step: 'preview' },
      {
        type: 'PREVIEW_RECEIVED',
        total: 2,
        rows: [
          {
            ...sample,
            overrideCategoryId: null,
            included: true,
          },
        ],
      },
    )
    const edited = bulkCategorizeWizardReducer(withPreview, {
      type: 'PREVIEW_EDITED',
      expenseId: sample.expenseId,
      categoryId: 'groceries',
    })
    const excluded = bulkCategorizeWizardReducer(edited, {
      type: 'PREVIEW_INCLUDED',
      expenseId: sample.expenseId,
      included: false,
    })
    const done = bulkCategorizeWizardReducer(excluded, {
      type: 'SAVED',
      applied: 1,
    })

    expect(excluded.previewRows[0]).toMatchObject({
      overrideCategoryId: 'groceries',
      included: false,
    })
    expect(done).toMatchObject({ step: 'done', savedApplied: 1 })
  })

  it('resets a wizard session', () => {
    const reset = bulkCategorizeWizardReducer(
      { ...initialBulkCategorizeWizardState, step: 'preview', previewTotal: 5 },
      { type: 'RESET' },
    )
    expect(reset).toEqual(initialBulkCategorizeWizardState)
  })
})
