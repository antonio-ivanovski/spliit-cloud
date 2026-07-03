import type { GroupChangedField } from '@spliit/domain/activities'
import { createCompositeDiffer } from '../activity-diff/composite.differ'
import type {
  DiffableGroup,
  GroupChangeContext,
  GroupDiffEmission,
  GroupDiffer,
} from './types'

export const compositeGroupDiffer = (differs: GroupDiffer[]) =>
  createCompositeDiffer<
    DiffableGroup,
    GroupChangedField,
    GroupChangeContext,
    GroupDiffEmission
  >(differs)

export type CompositeGroupDiffer = ReturnType<typeof compositeGroupDiffer>
