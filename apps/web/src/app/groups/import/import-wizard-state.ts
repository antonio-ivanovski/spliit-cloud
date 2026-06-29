import type {
  NormalizedSource,
  NormalizedSourceExpense,
  NormalizedSourceParticipant,
} from '@spliit/domain/import'

export type ImportStep =
  | 'source'
  | 'destination'
  | 'mapping'
  | 'confirm'
  | 'done'

export type ImportMode = 'NEW_GROUP' | 'EXISTING_GROUP'

export type ParticipantMappingMode =
  | 'LINK_ACCOUNT'
  | 'INVITE_BY_EMAIL'
  | 'INVITE_BY_LINK'
  | 'UNLINKED_PARTICIPANT'
  | 'LINK_EXISTING_PARTICIPANT'

export type ParticipantMappingState = {
  key: string
  source: NormalizedSourceParticipant
  mode: ParticipantMappingMode
  linkedAccountId?: string
  inviteEmail?: string
  existingLedgerParticipantId?: string
}

export type WizardState = {
  step: ImportStep
  source: NormalizedSource | null
  prefillSourceUrl: string | null
  mode: ImportMode | null
  targetGroupId: string | null
  groupFormValues: {
    name: string
    information: string
    currency: string
    currencyCode: string
  }
  participants: ParticipantMappingState[]
  sourceIdToDestId: Record<string, string>
  destIds: Record<string, string>
  resolvedExpenses: NormalizedSourceExpense[]
  rates: Record<string, number> | null | undefined
}

export const initialGroupFormValues = (source: NormalizedSource | null) => ({
  name: source?.name ?? '',
  information: '',
  currency: source?.currency ?? '€',
  currencyCode: source?.currencyCode ?? '',
})

/**
 * Map the batched expenses into the shape the import mutation expects.
 */
export function buildImportExpenses<
  T extends { paidBy: string; amount: number; originalAmount?: number },
>(
  expenses: T[],
): Array<
  Omit<T, 'paidBy'> & {
    paidByList: Array<{ participant: string; shares: number }>
    paidBySplitMode: 'BY_AMOUNT'
  }
> {
  return expenses.map(({ paidBy, ...rest }) => ({
    ...rest,
    paidByList: [
      { participant: paidBy, shares: rest.originalAmount ?? rest.amount },
    ],
    paidBySplitMode: 'BY_AMOUNT' as const,
  }))
}
