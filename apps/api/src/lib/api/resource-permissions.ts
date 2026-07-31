import { TRPCError } from '@trpc/server'

import type { GroupRole } from '@spliit/db'

export type OwnedResourcePermissions = {
  canEdit: boolean
  canDelete: boolean
}

export type ExpensePermissions = OwnedResourcePermissions & {
  canManageRecurrence: boolean
}

export function canManageOwnedResource(args: {
  role: GroupRole
  accountId: string
  createdByAccountId: string | null
}): boolean {
  return (
    args.role === 'ADMIN' ||
    (args.createdByAccountId !== null &&
      args.createdByAccountId === args.accountId)
  )
}

export function expenseOwnerAccountId(expense: {
  createdByAccountId: string | null
  recurringSeries?: { creatorAccountId: string | null } | null
}): string | null {
  return expense.recurringSeries?.creatorAccountId ?? expense.createdByAccountId
}

export function expensePermissions(args: {
  role: GroupRole
  accountId: string
  createdByAccountId: string | null
  recurringSeries?: { creatorAccountId: string | null } | null
  archived: boolean
}): ExpensePermissions {
  const ownerId = expenseOwnerAccountId(args)
  const permissions = ownedResourcePermissions({
    role: args.role,
    accountId: args.accountId,
    createdByAccountId: ownerId,
    archived: args.archived,
  })
  return {
    ...permissions,
    canManageRecurrence: Boolean(args.recurringSeries) && permissions.canEdit,
  }
}

export function ownedResourcePermissions(args: {
  role: GroupRole
  accountId: string
  createdByAccountId: string | null
  archived: boolean
}): OwnedResourcePermissions {
  const allowed =
    !args.archived &&
    canManageOwnedResource({
      role: args.role,
      accountId: args.accountId,
      createdByAccountId: args.createdByAccountId,
    })
  return { canEdit: allowed, canDelete: allowed }
}

export function assertCanManageOwnedResource(
  args: {
    role: GroupRole
    accountId: string
    createdByAccountId: string | null
  },
  message: string,
): void {
  if (!canManageOwnedResource(args)) {
    throw new TRPCError({ code: 'FORBIDDEN', message })
  }
}

export function canCreateInvitationWithRole(
  role: GroupRole,
  invitationRole: GroupRole,
): boolean {
  return role === 'ADMIN' || invitationRole === 'MEMBER'
}

export function canRevokeInvitation(args: {
  role: GroupRole
  accountId: string
  invitedById: string
  isUnused: boolean
}): boolean {
  return (
    args.role === 'ADMIN' ||
    (args.invitedById === args.accountId && args.isUnused)
  )
}
