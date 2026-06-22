import type { AppRouterOutput } from '@spliit/api/router'
import { randomId } from '@spliit/domain'

export { randomId }

export type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
export type GroupDetails = AppRouterOutput['groups']['getDetails']['group']
export type Groups = AppRouterOutput['groups']['list']['groups']
export type GroupExpenses =
  AppRouterOutput['groups']['expenses']['list']['expenses']
export type GroupExpense = GroupExpenses[number]

export const getGroup = undefined as unknown as (
  groupId: string,
) => Promise<Group | null>
export const getGroups = undefined as unknown as (
  groupIds: string[],
) => Promise<Groups>
export const getGroupExpenses = undefined as unknown as (
  groupId: string,
  options?: { offset?: number; length?: number; filter?: string },
) => Promise<GroupExpenses>
