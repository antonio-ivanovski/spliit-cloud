import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { ExpenseForm } from './expense-form'
import { EXPENSE_LIST_PAGE_SIZE } from './expense-list-query'

const createExpenseRouteApi = getRouteApi('/groups/$groupId/expenses/create')

export function CreateExpenseForm({
  groupId,
  runtimeFeatureFlags,
}: {
  groupId: string
  expenseId?: string
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Expenses' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { data: groupData } = trpc.groups.get.useQuery({ groupId })
  const group = groupData?.group
  const currentLedgerParticipantId =
    groupData?.currentLedgerParticipantId ?? null
  const isPendingInvitee = useIsPendingInvitee()
  const linkInviteToken = useLinkInviteToken()

  const { mutateAsync: createExpenseMutateAsync } =
    trpc.groups.expenses.create.useMutation()

  const utils = trpc.useUtils()
  const router = useRouter()
  // Read create-route search params here (we are guaranteed to be on the
  // create route). `ExpenseForm` is shared with the edit route, where
  // calling `useSearch` against the create route would throw "Could not
  // find an active match".
  const searchParams = createExpenseRouteApi.useSearch()

  if (!group) return null

  if (isPendingInvitee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tGroups('pendingInviteeExpenseTitle')}</CardTitle>
          <CardDescription>{t('create')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {tGroups('pendingInviteeExpenseDescription')}
          </p>
          <div>
            <Button asChild variant="secondary">
              <Link href={`/groups/${groupId}/expenses`}>
                {tGroups('backToExpenses')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (group.archived) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tGroups('bannerArchived')}</CardTitle>
          <CardDescription>{t('create')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {tGroups('archivedReadOnly')}
          </p>
          <div>
            <Button asChild variant="secondary">
              <Link href={`/groups/${groupId}/expenses`}>
                {tGroups('backToExpenses')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <ExpenseForm
      group={group}
      searchParams={searchParams}
      currentLedgerParticipantId={currentLedgerParticipantId}
      onSubmit={async (expense) => {
        await createExpenseMutateAsync({
          groupId,
          expense,
        })
        await utils.groups.expenses.list.reset({
          groupId,
          limit: EXPENSE_LIST_PAGE_SIZE,
          filter: '',
          linkInviteToken,
        })
        await utils.groups.activities.invalidate()
        await utils.groups.leavePreview.invalidate({ groupId })
        // A manual settlement expense (reimbursement) can clear the
        // invitee's balance; drop the cached `revokePreview` so the
        // revoke dialog re-reads `hasUnsettledBalance` instead of
        // showing the stale warning.
        await utils.invitations.revokePreview.invalidate()
        router.push({
          to: '/groups/$groupId/expenses',
          params: { groupId: group.id },
        })
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
