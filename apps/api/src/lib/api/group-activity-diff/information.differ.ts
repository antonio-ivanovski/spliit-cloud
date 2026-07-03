import type { GroupDiffer } from './types'

export const informationDiffer: GroupDiffer = {
  field: 'information',
  check(oldGroup, newGroup) {
    return (oldGroup.information ?? null) !== (newGroup.information ?? null)
  },
  diff(oldGroup, newGroup) {
    if (!this.check(oldGroup, newGroup)) return null
    return {
      field: 'information',
      before: oldGroup.information ?? null,
      after: newGroup.information ?? null,
    }
  },
}
