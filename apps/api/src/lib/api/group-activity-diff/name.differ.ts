import { createStringFieldDiffer } from '../activity-diff/factories'
import type { GroupDiffer } from './types'

export const nameDiffer: GroupDiffer = createStringFieldDiffer({
  field: 'name',
  getValue: (group) => group.name,
})
