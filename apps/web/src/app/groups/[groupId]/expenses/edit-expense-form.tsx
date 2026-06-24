'use client'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { ExpenseForm } from './expense-form'

export function EditExpenseForm({
  groupId,
  expenseId,
  runtimeFeatureFlags,
}: {
  groupId: string
  expenseId: string
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const { data: groupData } = trpc.groups.get.useQuery({ groupId })
  const group = groupData?.group
  const currentLedgerParticipantId =
    groupData?.currentLedgerParticipantId ?? null

  const { data: expenseData } = trpc.groups.expenses.get.useQuery({
    groupId,
    expenseId,
  })
  const expense = expenseData?.expense

  const { mutateAsync: updateExpenseMutateAsync } =
    trpc.groups.expenses.update.useMutation()
  const { mutateAsync: deleteExpenseMutateAsync } =
    trpc.groups.expenses.delete.useMutation()

  const utils = trpc.useUtils()
  const router = useRouter()

  if (!group || !expense) return null

  const readOnly = !!group.archived

  return (
    <ExpenseForm
      group={group}
      expense={expense}
      currentLedgerParticipantId={currentLedgerParticipantId}
      readOnly={readOnly}
      onSubmit={async (expenseFormValues) => {
        if (readOnly) return
        await updateExpenseMutateAsync({
          expenseId,
          groupId,
          expenseFormValues,
        })
        utils.groups.expenses.invalidate()
        router.push(`/groups/${group.id}`)
      }}
      onDelete={async () => {
        if (readOnly) return
        await deleteExpenseMutateAsync({
          expenseId,
          groupId,
        })
        utils.groups.expenses.invalidate()
        router.push(`/groups/${group.id}`)
      }}
      runtimeFeatureFlags={runtimeFeatureFlags}
    />
  )
}
