import type { AppRouterOutput } from '@spliit/api/router'
import { randomId } from '@spliit/domain'

export { randomId }

export type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
export type GroupDetails = AppRouterOutput['groups']['getDetails']['group']
export type Groups = AppRouterOutput['groups']['list']['groups']
export type GroupExpenses =
  AppRouterOutput['groups']['expenses']['list']['expenses']
export type GroupExpense = GroupExpenses[number]

export async function getGroup(_groupId: string): Promise<Group | null> {
  throw new Error('getGroup is not available on the client; use trpc.groups.get')
}
export async function getGroups(_groupIds: string[]): Promise<Groups> {
  throw new Error(
    'getGroups is not available on the client; use trpc.groups.list',
  )
}
export async function getGroupExpenses(
  _groupId: string,
  _options?: { offset?: number; length?: number; filter?: string },
): Promise<GroupExpenses> {
  throw new Error(
    'getGroupExpenses is not available on the client; use trpc.groups.expenses.list',
  )
}
