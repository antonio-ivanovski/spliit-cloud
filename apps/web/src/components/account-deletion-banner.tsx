/* oxlint-disable jsx-a11y/prefer-tag-over-role -- status announces scheduled deletion updates politely. */
import { Link } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

/** A shared-cache notice; changing accounts first discards the previous status. */
export function AccountDeletionBanner({
  hidden = false,
}: {
  hidden?: boolean
}) {
  const { data: account, isPending, error } = useCurrentAccount()
  return (
    <AccountDeletionNotice
      key={account?.id ?? 'signed-out'}
      accountId={account?.id ?? null}
      hidden={hidden}
      sessionReady={!isPending && !error}
    />
  )
}

function AccountDeletionNotice({
  accountId,
  hidden,
  sessionReady,
}: {
  accountId: string | null
  hidden: boolean
  sessionReady: boolean
}) {
  const online = useOnlineStatus()
  const utils = trpc.useUtils()
  const [ready, setReady] = useState(false)
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: 'AccountDeletionBanner',
  })

  useEffect(() => {
    let active = true
    // Status has no account ID in its query key. Cancel old requests before
    // resetting it, and keep this observer disabled until that reset finishes.
    void (async () => {
      await utils.account.deletionStatus.cancel()
      await utils.account.deletionStatus.reset()
      if (active) setReady(true)
    })()
    return () => {
      active = false
    }
  }, [accountId, utils])

  const status = trpc.account.deletionStatus.useQuery(undefined, {
    enabled: Boolean(accountId) && ready && !hidden && sessionReady && online,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: (query) =>
      online ? (query.state.data?.request ? 5000 : 30_000) : false,
    refetchIntervalInBackground: false,
  })

  const request = status.data?.request
  if (hidden || !accountId || !ready || !request) return null

  const executing = request.status === 'EXECUTING'
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(request.executeAt))

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-b border-destructive/25 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <div className="flex items-start justify-center gap-2 px-4 py-2 text-sm leading-6">
        <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span>{executing ? t('executing') : t('scheduled', { date })}</span>
          <Link
            to="/account/delete"
            className="font-medium underline underline-offset-2 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden"
          >
            {t(executing ? 'viewStatus' : 'review')}
          </Link>
        </div>
      </div>
    </div>
  )
}
