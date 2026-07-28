import type {
  GroupActivityChange,
  GroupChangedField,
} from '@spliit/domain/activities'

import { compositeGroupDiffer } from './composite.differ'
import { currencyDiffer } from './currency.differ'
import { informationDiffer } from './information.differ'
import { nameDiffer } from './name.differ'
import type { DiffableGroup, GroupChangeContext } from './types'

export { compositeGroupDiffer } from './composite.differ'
export type { CompositeGroupDiffer } from './composite.differ'
export type {
  DiffableGroup,
  GroupChangeContext,
  GroupDiffEmission,
  GroupDiffer,
} from './types'

export { currencyDiffer } from './currency.differ'
export { informationDiffer } from './information.differ'
export { nameDiffer } from './name.differ'

const defaultDiffer = compositeGroupDiffer([
  nameDiffer,
  informationDiffer,
  currencyDiffer,
])

export function getGroupChangedFields(
  oldGroup: DiffableGroup,
  newGroup: DiffableGroup,
): GroupChangedField[] | null {
  return defaultDiffer.changedFields(oldGroup, newGroup)
}

export function getGroupChangeSummary(
  oldGroup: DiffableGroup,
  newGroup: DiffableGroup,
  ctx: GroupChangeContext,
): {
  changedFields: GroupChangedField[]
  changes: GroupActivityChange[]
} | null {
  const diffs = defaultDiffer.changeSummary(oldGroup, newGroup, ctx)
  if (!diffs) return null
  return {
    changedFields: diffs.map((d) => d.field),
    changes: diffs as GroupActivityChange[],
  }
}
