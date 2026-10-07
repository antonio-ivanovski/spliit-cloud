import { Link } from '@tanstack/react-router'
import { Loader2, Trash2, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import { SettingsRow, SettingsSection } from './settings-ui'

export function AccountDeletionSettings() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.deletion',
  })
  const isOnline = useOnlineStatus()
  // Deletion status is connection-required: never poll offline.
  const status = trpc.account.deletionStatus.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.request ? 5000 : false),
    enabled: isOnline,
  })
  return (
    <SettingsSection
      id="account-deletion"
      title={t('sectionTitle')}
      description={t('sectionDescription')}
      icon={Trash2 as LucideIcon}
    >
      <div className="border-t border-border/70">
        {status.data?.request ? (
          <div className="px-4 py-4 sm:px-6">
            <ScheduledDeletion request={status.data.request} />
          </div>
        ) : (
          <SettingsRow
            id="account-deletion-row"
            label={t('rowLabel')}
            description={t('rowDescription')}
            control={
              <Link
                to="/account/delete"
                className={buttonVariants({
                  variant: 'destructive',
                  size: 'sm',
                })}
              >
                {t('open')}
              </Link>
            }
          />
        )}
      </div>
    </SettingsSection>
  )
}

export function ScheduledDeletion({
  request,
  onCancelled,
}: {
  request: { executeAt: string | Date; status?: 'PENDING' | 'EXECUTING' }
  onCancelled?: () => void
}) {
  const { t, i18n } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.deletion',
  })
  const { data: account } = useCurrentAccount()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const cancel = trpc.account.cancelDeletion.useMutation({
    onSuccess: async () => {
      onCancelled?.()
      await utils.account.deletionStatus.invalidate()
      await utils.account.deletionPreview.invalidate()
      toast({ description: t('cancelled') })
    },
    onError: async () => {
      await utils.account.deletionStatus.invalidate()
      toast({ description: t('errors.cancelFailed'), variant: 'destructive' })
    },
  })
  const executing = request.status === 'EXECUTING'
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(request.executeAt))
  return (
    <Alert variant="destructive" className="p-5 sm:p-6">
      <AlertDescription>
        <h2 className="text-xl font-semibold tracking-tight">
          {t(executing ? 'executingTitle' : 'scheduledTitle')}
        </h2>
        <p className="mt-3 leading-6">
          {executing
            ? t('executingDescription')
            : t('scheduledDescription', { date, email: account?.email ?? '' })}
        </p>
        {!executing && (
          <Button
            variant="outline"
            className="mt-5"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending && <Loader2 className="size-4 animate-spin" />}
            {cancel.isPending ? t('cancelling') : t('cancel')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
