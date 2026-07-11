import { CreateFromReceiptButton } from '@/app/groups/[groupId]/expenses/create-from-receipt-button'
import { ExpenseList } from '@/app/groups/[groupId]/expenses/expense-list'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
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
  // Pending invitees have read-only access — block the receipt extraction
  // and create affordances so they can only browse. Export now lives in
  // group settings. The server rejects the corresponding mutations anyway.
  const canEdit = !isArchived && !isPendingInvitee
  const showReceiptButton = enableReceiptExtract && canEdit

  return (
    <Card className="mb-4 rounded-none -mx-4 border-x-0 sm:border-x sm:rounded-lg sm:mx-0">
      <div className="flex flex-row items-center gap-4 p-4 sm:justify-between sm:gap-x-6 sm:p-6">
        <div className="min-w-0 flex-1">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        {canEdit && (
          <div className="flex shrink-0">
            {showReceiptButton && (
              <CreateFromReceiptButton
                responsive
                className="rounded-r-none border-r-0"
              />
            )}
            <Button
              asChild
              size="icon"
              className={cn(
                'h-11 w-11 sm:h-10 sm:w-auto sm:px-4 sm:py-2',
                showReceiptButton &&
                  'rounded-l-none border-l border-primary-foreground/20',
              )}
            >
              <Link
                href={`/groups/${groupId}/expenses/create`}
                title={t('create')}
                aria-label={t('create')}
              >
                <Plus className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('create')}</span>
              </Link>
            </Button>
          </div>
        )}
      </div>

      <CardContent className="p-0 pt-2 pb-4 sm:pb-6 flex flex-col gap-4 relative">
        <ExpenseList />
      </CardContent>
    </Card>
  )
}
