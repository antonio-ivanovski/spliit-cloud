import { createStringFieldDiffer } from '../activity-diff/factories'
import type { GroupDiffer } from './types'

export const emojiDiffer: GroupDiffer = createStringFieldDiffer({
  field: 'emoji',
  getValue: (group) => group.emoji,
})
