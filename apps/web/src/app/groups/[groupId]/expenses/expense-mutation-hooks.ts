import { useToast } from '@/components/ui/use-toast'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import type { InfiniteData } from '@tanstack/react-query'
import { EXPENSE_LIST_PAGE_SIZE } from './expense-list-query'

type ExpenseListPage = AppRouterOutput['groups']['expenses']['list']
type ExpenseListData = InfiniteData<ExpenseListPage, number | null>

function useInvalidateExpenseDependencies(linkInviteToken: string | undefined) {
  const utils = trpc.useUtils()

  return ({ groupId, expenseId }: { groupId: string; expenseId?: string }) =>
    Promise.all([
      utils.groups.expenses.list.reset({
        groupId,
        limit: EXPENSE_LIST_PAGE_SIZE,
        filter: '',
        linkInviteToken,
      }),
      expenseId
        ? utils.groups.expenses.get.invalidate({
            groupId,
            expenseId,
            linkInviteToken,
          })
        : Promise.resolve(),
      utils.groups.activities.invalidate(),
      utils.groups.leavePreview.invalidate({ groupId }),
      utils.invitations.revokePreview.invalidate(),
    ])
}

function useInvalidateExpenseSideEffects() {
  const utils = trpc.useUtils()

  return ({ groupId }: { groupId: string }) =>
    Promise.all([
      utils.groups.activities.invalidate(),
      utils.groups.leavePreview.invalidate({ groupId }),
      utils.invitations.revokePreview.invalidate(),
    ])
}

export function useUpdateExpenseMutation({
  linkInviteToken,
}: {
  linkInviteToken: string | undefined
}) {
  const invalidateExpenseDependencies =
    useInvalidateExpenseDependencies(linkInviteToken)

  return trpc.groups.expenses.update.useMutation({
    onSuccess: (_data, variables) => {
      return invalidateExpenseDependencies({
        groupId: variables.groupId,
        expenseId: variables.expenseId,
      })
    },
  })
}

export function useCreateExpenseMutation({
  linkInviteToken,
}: {
  linkInviteToken: string | undefined
}) {
  const utils = trpc.useUtils()
  const invalidateExpenseSideEffects = useInvalidateExpenseSideEffects()

  return trpc.groups.expenses.create.useMutation({
    onSuccess: (_data, variables) => {
      return Promise.all([
        utils.groups.expenses.list.reset({
          groupId: variables.groupId,
          limit: EXPENSE_LIST_PAGE_SIZE,
          filter: '',
          linkInviteToken,
        }),
        invalidateExpenseSideEffects({ groupId: variables.groupId }),
      ])
    },
  })
}

export function useDeleteExpenseMutation({
  linkInviteToken,
}: {
  linkInviteToken: string | undefined
}) {
  const utils = trpc.useUtils()
  const router = useRouter()
  const { toast } = useToast()
  const invalidateExpenseSideEffects = useInvalidateExpenseSideEffects()

  return trpc.groups.expenses.delete.useMutation({
    onMutate: async (variables) => {
      const listInput = {
        groupId: variables.groupId,
        limit: EXPENSE_LIST_PAGE_SIZE,
        filter: '',
        linkInviteToken,
      }

      await utils.groups.expenses.list.cancel(listInput)
      const previousList = utils.groups.expenses.list.getInfiniteData(listInput)

      utils.groups.expenses.list.setInfiniteData(listInput, (old) => {
        if (!old) return old

        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            expenses: page.expenses.filter(
              (expense) => expense.id !== variables.expenseId,
            ),
          })),
        } satisfies ExpenseListData
      })

      return { listInput, previousList }
    },
    onSuccess: (_data, variables) => {
      router.replace({
        to: '/groups/$groupId/expenses',
        params: { groupId: variables.groupId },
      })

      void invalidateExpenseSideEffects({ groupId: variables.groupId })
    },
    onError: (error, _variables, context) => {
      if (context?.previousList) {
        utils.groups.expenses.list.setInfiniteData(
          context.listInput,
          context.previousList,
        )
      }
      toast({ description: error.message, variant: 'destructive' })
    },
  })
}
