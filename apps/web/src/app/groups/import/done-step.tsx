import { AlertCircle, CheckCircle2, Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { isPlaceholderEmail } from '@/lib/account'
import type { AppRouterOutput } from '@spliit/api/router'

type ImportInvite = NonNullable<
  AppRouterOutput['groups']['import']
>['invites'][number]

type Props = {
  groupId: string | null
  invites: ImportInvite[]
  importedDocumentCount?: number
  onContinue: () => void
  continueLabel?: string
  batchSummary?: {
    completed: Array<{ sourceId: string; name: string }>
    skipped: Array<{ sourceId: string; name: string }>
  }
}

/**
 * Final step of the import wizard.
 *
 * Surfaces shareable-link URLs the server generated during the import. The user
 * copies and distributes these links manually (we don't have the invitees'
 * emails for them). Email-targeted invitations are also listed for transparency
 * but have no copyable URL — the server sent the invite mail directly.
 *
 * The shareable-link UX mirrors the per-group invite-link card on the Members
 * tab: read-only input, copy button, and a Share button (rendered only when
 * `navigator.share` is available). Reusing the same affordances keeps the
 * import path consistent with the rest of the app.
 */
export function DoneStep({
  groupId: _groupId,
  invites,
  importedDocumentCount = 0,
  onContinue,
  continueLabel,
  batchSummary,
}: Props) {
  const { t } = useTranslation()
  const linkInvites = invites.filter((i) => i.kind === 'LINK' && i.inviteUrl)
  const emailInvites = invites.filter((i) => i.kind === 'EMAIL')
  const isBatchComplete = batchSummary !== undefined

  // Mobile share via the Web Share API. Same probing pattern as
  // the Members invite-link UI — iOS Safari, Android Chrome, and a
  // handful of desktop browsers expose `navigator.share`; on
  // unsupported platforms we only render the copy button.
  const canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function handleShareLink(url: string, name: string) {
    if (!canShare) return
    try {
      await navigator.share({
        title: t('Groups.Import.Done.shareTitle'),
        text: t('Groups.Import.Done.shareText', { name, url }),
        url,
      })
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.warn('[invite] share failed:', err)
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <div className="flex flex-col gap-1">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {isBatchComplete
                ? t('Groups.Import.Cloud.accountTitle')
                : t('Groups.Import.StepHeader.done')}
            </p>
            <h2 className="text-xl font-semibold">
              {t('Groups.Import.Done.importComplete')}
            </h2>
          </div>
          {importedDocumentCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('Groups.Import.Documents.recovered', {
                count: importedDocumentCount,
              })}
            </p>
          )}
          {batchSummary ? (
            <ul className="w-full max-w-md divide-y rounded-lg border text-start text-sm">
              {batchSummary.completed.map((group) => (
                <li
                  key={group.sourceId}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-green-500"
                    aria-hidden="true"
                  />
                  <span className="truncate">{group.name}</span>
                </li>
              ))}
              {batchSummary.skipped.map((group) => (
                <li
                  key={group.sourceId}
                  className="flex items-center gap-2 px-3 py-2 text-muted-foreground"
                >
                  <AlertCircle
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="truncate line-through">{group.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Button onClick={onContinue}>
            {continueLabel ?? t('Groups.Import.Done.openGroup')}
          </Button>
        </CardContent>
      </Card>

      {linkInvites.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div>
              <h2 className="text-base font-medium">
                {t('Groups.Import.Done.shareableLinksTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('Groups.Import.Done.shareableLinksDescription')}
              </p>
            </div>
            <ul className="flex flex-col gap-4">
              {linkInvites.map((invite) =>
                invite.inviteUrl ? (
                  <li key={invite.invitationId} className="flex flex-col gap-2">
                    <p className="font-medium">{invite.sourceName}</p>
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={invite.inviteUrl}
                        className="font-mono text-xs"
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <CopyButton
                        text={invite.inviteUrl}
                        ariaLabel={t('Groups.Import.Done.copyLink')}
                        copiedLabel={t('Groups.Import.Done.copied')}
                      />
                      {canShare && (
                        <Button
                          size="icon"
                          variant="secondary"
                          type="button"
                          onClick={() =>
                            handleShareLink(
                              invite.inviteUrl!,
                              invite.sourceName,
                            )
                          }
                          aria-label={t('Groups.Import.Done.shareAriaLabel')}
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                ) : null,
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {emailInvites.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-2 p-4">
            <h2 className="text-base font-medium">
              {t('Groups.Import.Done.emailInvitesTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('Groups.Import.Done.emailInvitesDescription')}
            </p>
            <ul className="text-sm">
              {emailInvites.map((invite) => (
                <li
                  key={invite.invitationId}
                  className="flex items-center justify-between gap-3 py-1"
                >
                  <span className="font-medium">{invite.sourceName}</span>
                  {!isPlaceholderEmail(invite.email) && (
                    <span className="text-muted-foreground">
                      {invite.email}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
