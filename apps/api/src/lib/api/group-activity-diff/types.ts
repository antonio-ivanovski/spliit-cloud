import type { GroupChangedField } from '@spliit/domain/activities'

import type {
  ActivityDiffer,
  DiffEmission as GenericDiffEmission,
} from '../activity-diff/types'

export type DiffableGroup = {
  name: string
  information: string | null
  currency: string
  currencyCode: string | null
}

export type GroupChangeContext = Record<string, never>

export type GroupDiffEmission = GenericDiffEmission<GroupChangedField>

export type GroupDiffer = ActivityDiffer<
  DiffableGroup,
  GroupChangedField,
  GroupChangeContext,
  GroupDiffEmission
>
