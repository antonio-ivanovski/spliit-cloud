import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLocale } from '@/i18n/react'
import { detectDeviceTimeZone } from '@/lib/account-preferences'

import { formatDate } from './members-hooks'

/**
 * One-time shareable-link result view. The URL exists only in the caller's
 * component state — this panel never fetches it from the server, so it must
 * only be rendered with a fresh, never-persisted value.
 */
export function GeneratedInviteLinkPanel({
  inviteUrl,
  expiresAt,
  onShare,
  canShare,
  className,
}: {
  inviteUrl: string
  expiresAt: Date | string
  onShare: () => void
  canShare: boolean
  className?: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'

  return (
    <div className={className} data-testid="generated-invite-link">
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={inviteUrl}
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyButton
          text={inviteUrl}
          ariaLabel={t('invite.link.copyLink')}
          copiedLabel={t('invite.link.copied')}
        />
        {canShare && (
          <Button
            size="icon"
            variant="secondary"
            type="button"
            onClick={onShare}
            aria-label={t('invite.link.share')}
          >
            <Share2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('invite.link.expiresOn', {
          date: formatDate(expiresAt, locale, accountTimeZone),
        })}
      </p>
    </div>
  )
}
