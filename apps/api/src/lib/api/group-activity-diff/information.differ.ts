import { createStringFieldDiffer } from '../activity-diff/factories'
import type { GroupDiffer } from './types'

export const informationDiffer: GroupDiffer = createStringFieldDiffer({
  field: 'information',
  getValue: (group) => group.information,
})
