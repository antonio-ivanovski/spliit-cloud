import { TRPCError } from '@trpc/server'

import { getCurrency } from '@spliit/domain/currency'

import { loadGroupMutationContext } from '../../trpc/init'
import { SwapRateError, SwapValidationError } from './errors'

type SwapAction = 'preview' | 'execute'

/**
 * Shared ADMIN/archived/currency guard for the three swap procedures. One place
 * enforces the locked requirements so a future edit (offline handling,
 * custom-ledger handling) cannot silently weaken one procedure.
 */
export async function authorizeSwapAccess({
  groupId,
  accountId,
  targetCurrencyCode,
  action,
}: {
  groupId: string
  accountId: string
  targetCurrencyCode: string
  action: SwapAction
}) {
  const { group, member, ledger } = await loadGroupMutationContext({
    groupId,
    accountId,
  })
  if (member.role !== 'ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        action === 'execute'
          ? 'Only admins can swap the group currency'
          : 'Only admins can preview a currency swap',
    })
  }
  if (group.archived) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This group is archived and its currency cannot be changed',
    })
  }
  const oldCode = (ledger.currencyCode ?? '').toUpperCase()
  const newCode = targetCurrencyCode.toUpperCase()
  if (!oldCode) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Currency swap requires an ISO group currency',
    })
  }
  if (!getCurrency(newCode)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unsupported target currency: ${newCode}`,
    })
  }
  if (oldCode === newCode) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Target currency must differ from the current group currency',
    })
  }
  return { group, member, ledger, oldCode, newCode }
}

/** Map tagged swap failures to stable TRPC codes; rethrow anything else. */
export function mapSwapErrorToTRPC(cause: unknown): never {
  if (cause instanceof SwapValidationError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: cause.reason })
  }
  if (cause instanceof SwapRateError) {
    throw new TRPCError({ code: 'BAD_GATEWAY', message: cause.reason })
  }
  throw cause
}
