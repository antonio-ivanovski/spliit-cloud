import type { trpc } from '@/trpc/client'

export function invalidateAccountGroupLists(
  utils: ReturnType<typeof trpc.useUtils>,
) {
  return Promise.all([
    utils.account.groups.invalidate(),
    utils.overview.get.invalidate(),
  ])
}
