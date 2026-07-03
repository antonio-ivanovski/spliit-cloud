import type { GroupChangedField } from '@spliit/domain/activities'
import type {
  DiffableGroup,
  GroupChangeContext,
  GroupDiffEmission,
  GroupDiffer,
} from './types'

export const compositeGroupDiffer = (differs: GroupDiffer[]) => ({
  getDiffers(): ReadonlyArray<GroupDiffer> {
    return differs
  },

  changedFields(
    oldGroup: DiffableGroup,
    newGroup: DiffableGroup,
  ): GroupChangedField[] | null {
    const fields = differs
      .filter((d) => d.check(oldGroup, newGroup))
      .map((d) => d.field)
    return fields.length > 0 ? fields : null
  },

  changeSummary(
    oldGroup: DiffableGroup,
    newGroup: DiffableGroup,
    ctx: GroupChangeContext,
  ): GroupDiffEmission[] | null {
    const diffs = differs
      .map((d) => d.diff(oldGroup, newGroup, ctx))
      .filter((e): e is GroupDiffEmission => e !== null)
    return diffs.length > 0 ? diffs : null
  },
})

export type CompositeGroupDiffer = ReturnType<typeof compositeGroupDiffer>
