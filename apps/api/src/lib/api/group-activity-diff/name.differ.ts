import type { GroupDiffer } from './types'

export const nameDiffer: GroupDiffer = {
  field: 'name',
  check(oldGroup, newGroup) {
    return oldGroup.name !== newGroup.name
  },
  diff(oldGroup, newGroup) {
    if (!this.check(oldGroup, newGroup)) return null
    return {
      field: 'name',
      before: oldGroup.name,
      after: newGroup.name,
    }
  },
}
