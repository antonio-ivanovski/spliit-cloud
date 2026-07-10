import type { CategoryId } from '@spliit/domain'

export type BulkCategorizeStep = 'intro' | 'calibration' | 'preview' | 'done'

export type PriorSelection = { expenseId: string; categoryId: CategoryId }

export type CalibrationSelection = {
  expenseId: string
  title: string
  suggestedCategoryId: CategoryId
  confidence: 'high' | 'medium' | 'low'
}

export type PreviewRow = {
  expenseId: string
  title: string
  suggestedCategoryId: CategoryId
  overrideCategoryId: CategoryId | null
  confidence: 'high' | 'medium' | 'low'
  included: boolean
}

export type BulkCategorizeWizardState = {
  step: BulkCategorizeStep
  priorSelections: PriorSelection[]
  calibrationRound: number
  calibrationSelections: CalibrationSelection[]
  calibrationEdits: Record<string, CategoryId>
  calibrationReady: boolean
  previewRows: PreviewRow[]
  previewTotal: number
  savedApplied: number | null
}

export type BulkCategorizeWizardAction =
  | { type: 'START' }
  | {
      type: 'CALIBRATION_RECEIVED'
      priorSelections: PriorSelection[]
      selections: CalibrationSelection[]
      ready: boolean
    }
  | { type: 'CALIBRATION_EDITED'; expenseId: string; categoryId: CategoryId }
  | { type: 'OPEN_PREVIEW' }
  | { type: 'PREVIEW_RECEIVED'; rows: PreviewRow[]; total: number }
  | {
      type: 'PREVIEW_EDITED'
      expenseId: string
      categoryId: CategoryId
    }
  | { type: 'PREVIEW_INCLUDED'; expenseId: string; included: boolean }
  | { type: 'SAVED'; applied: number }
  | { type: 'BACK_TO_CALIBRATION' }
  | { type: 'RESET' }

export const initialBulkCategorizeWizardState: BulkCategorizeWizardState = {
  step: 'intro',
  priorSelections: [],
  calibrationRound: 0,
  calibrationSelections: [],
  calibrationEdits: {},
  calibrationReady: false,
  previewRows: [],
  previewTotal: 0,
  savedApplied: null,
}

export function bulkCategorizeWizardReducer(
  state: BulkCategorizeWizardState,
  action: BulkCategorizeWizardAction,
): BulkCategorizeWizardState {
  switch (action.type) {
    case 'START':
      return { ...state, step: 'calibration' }
    case 'CALIBRATION_RECEIVED':
      return {
        ...state,
        priorSelections: action.priorSelections,
        calibrationRound: state.calibrationRound + 1,
        calibrationSelections: action.selections,
        calibrationEdits: {},
        calibrationReady: action.ready,
      }
    case 'CALIBRATION_EDITED':
      return {
        ...state,
        calibrationEdits: {
          ...state.calibrationEdits,
          [action.expenseId]: action.categoryId,
        },
      }
    case 'OPEN_PREVIEW':
      return { ...state, step: 'preview' }
    case 'PREVIEW_RECEIVED':
      return {
        ...state,
        previewRows: action.rows,
        previewTotal: action.total,
      }
    case 'PREVIEW_EDITED':
      return {
        ...state,
        previewRows: state.previewRows.map((row) =>
          row.expenseId === action.expenseId
            ? { ...row, overrideCategoryId: action.categoryId }
            : row,
        ),
      }
    case 'PREVIEW_INCLUDED':
      return {
        ...state,
        previewRows: state.previewRows.map((row) =>
          row.expenseId === action.expenseId
            ? { ...row, included: action.included }
            : row,
        ),
      }
    case 'SAVED':
      return { ...state, step: 'done', savedApplied: action.applied }
    case 'BACK_TO_CALIBRATION':
      return { ...state, step: 'calibration' }
    case 'RESET':
      return initialBulkCategorizeWizardState
  }
}
