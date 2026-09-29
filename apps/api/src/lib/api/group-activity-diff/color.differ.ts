import { createStringFieldDiffer } from '../activity-diff/factories'
import type { GroupDiffer } from './types'

export const colorDiffer: GroupDiffer = createStringFieldDiffer({
  field: 'color',
  getValue: (group) => group.color,
})
