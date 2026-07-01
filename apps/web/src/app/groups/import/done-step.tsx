import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { AppRouterOutput } from '@spliit/api/router'
import { CheckCircle2, ExternalLink, SearchCheck, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ImportInvite = NonNullable<
  AppRouterOutput['groups']['import']
>['invites'][number]

const IMPORT_ISSUES_URL =
  'https://github.com/antonio-ivanovski/spliit-cloud/issues'

type Props = {
  groupId: string | null
  invites: ImportInvite[]
  onContinue: () => void
}

/**
 * Final step of the import wizard.
 *
 * Surfaces shareable-link URLs the server generated during the
 * import. The user copies and distributes these links manually (we
 * don't have the invitees' emails for them). Email-targeted
 * invitations are also listed for transparency but have no
 * copyable URL — the server sent the invite mail directly.
 *
 * The shareable-link UX mirrors the per-group invite-link card on
 * the Members tab: read-only input, copy button, and a Share button
 * (rendered only when `navigator.share` is available). Reusing the
 * same affordances keeps the import path consistent with the rest
 * of the app.
 */
export function DoneStep({ groupId, invites, onContinue }: Props) {
  const { t } = useTranslation()
  const linkInvites = invites.filter((i) => i.kind === 'LINK' && i.inviteUrl)
  const emailInvites = invites.filter((i) => i.kind === 'EMAIL')

  // Mobile share via the Web Share API. Same probing pattern as
  // the Members invite-link UI — iOS Safari, Android Chrome, and a
  // handful of desktop browsers expose `navigator.share`; on
  // unsupported platforms we only render the copy button.
  const [canShare, setCanShare] = useState(false)
  useEffect(() => {
    setCanShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    )
  }, [])

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
        <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
          <h2 className="text-lg font-medium">
            {t('Groups.Import.Done.importComplete')}
          </h2>
          <Button onClick={onContinue}>
            {t('Groups.Import.Done.openGroup')}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-primary/35 bg-primary/[0.03]">
        <CardContent className="flex gap-3 p-4">
          <SearchCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed text-foreground">
              {t('Groups.Import.Done.description')}
            </p>
            <a
              href={IMPORT_ISSUES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {IMPORT_ISSUES_URL}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
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
                      <CopyButton text={invite.inviteUrl} />
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
                          <Share2 className="w-4 h-4" />
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
          <CardContent className="p-4 flex flex-col gap-2">
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
                  <span className="text-muted-foreground">{invite.email}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
