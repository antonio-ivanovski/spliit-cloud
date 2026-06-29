import { ForceArchiveDialog } from '@/components/force-archive-dialog'
import type { AccountGroup } from './group-buckets'

export function ForceArchiveDialogSection({
  target,
  onClose,
}: {
  target: AccountGroup | null
  onClose: () => void
}) {
  return <ForceArchiveDialog groupId={target?.id ?? null} onClose={onClose} />
}
