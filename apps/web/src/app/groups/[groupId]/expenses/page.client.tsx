import { CreateFromReceiptButton } from '@/app/groups/[groupId]/expenses/create-from-receipt-button'
import { ExpenseList } from '@/app/groups/[groupId]/expenses/expense-list'
import ExportButton from '@/app/groups/[groupId]/export-button'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup, useIsPendingInvitee } from '../current-group-context'

export default function GroupExpensesPageClient({
  enableReceiptExtract,
}: {
  enableReceiptExtract: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const { groupId, group } = useCurrentGroup()
  const isPendingInvitee = useIsPendingInvitee()
  const isArchived = !!group?.archived
  // Pending invitees have read-only access — block the export, receipt
  // extraction, and "+" create affordances so they can only browse. The
  // server rejects the corresponding mutations anyway.
  const canEdit = !isArchived && !isPendingInvitee

  return (
    <Card className="mb-4 rounded-none -mx-4 border-x-0 sm:border-x sm:rounded-lg sm:mx-0">
      <div className="flex flex-1">
        <CardHeader className="flex-1 p-4 sm:p-6">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardHeader className="p-4 sm:p-6 flex flex-row space-y-0 gap-2">
          {!isPendingInvitee && <ExportButton groupId={groupId} />}
          {enableReceiptExtract && canEdit && <CreateFromReceiptButton />}
          {canEdit && (
            <Button asChild size="icon">
              <Link
                href={`/groups/${groupId}/expenses/create`}
                title={t('create')}
              >
                <Plus className="w-4 h-4" />
              </Link>
            </Button>
          )}
        </CardHeader>
      </div>

      <CardContent className="p-0 pt-2 pb-4 sm:pb-6 flex flex-col gap-4 relative">
        <ExpenseList />
      </CardContent>
    </Card>
  )
}
