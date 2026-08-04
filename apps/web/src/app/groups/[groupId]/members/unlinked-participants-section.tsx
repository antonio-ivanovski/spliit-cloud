import { Link2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { trpc } from '@/trpc/client'

import { LinkUnlinkedParticipantDialog } from './link-unlinked-participant-dialog'
import { SegmentedActions } from './segmented-actions'

export function UnlinkedParticipantsSection({
  groupId,
  canManage,
  onRemove,
}: {
  groupId: string
  canManage: boolean
  onRemove: (participant: { ledgerParticipantId: string; name: string }) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { data, isLoading } = trpc.groups.importLinks.listUnlinked.useQuery({
    groupId,
  })

  const [linkTarget, setLinkTarget] = useState<{
    id: string
    displayName: string
  } | null>(null)

  if (!canManage) return null
  const unlinked = data?.unlinked ?? []
  if (!isLoading && unlinked.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('unlinked.title')}</CardTitle>
        <CardDescription>{t('unlinked.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-3 py-1">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {unlinked.map((p: { id: string; displayName: string | null }) => (
              <li
                key={p.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {p.displayName || t('unknownMember')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('unlinked.idHint', { id: p.id })}
                  </p>
                </div>
                <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                  <SegmentedActions>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 gap-1.5 rounded-none px-3"
                      onClick={() =>
                        setLinkTarget({
                          id: p.id,
                          displayName: p.displayName || t('unknownMember'),
                        })
                      }
                    >
                      <Link2 className="size-4" aria-hidden="true" />
                      {t('unlinked.linkButton')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 gap-1.5 rounded-none px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        onRemove({
                          ledgerParticipantId: p.id,
                          name: p.displayName || t('unknownMember'),
                        })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t('remove')}
                    </Button>
                  </SegmentedActions>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <LinkUnlinkedParticipantDialog
        groupId={groupId}
        unlinkedParticipantId={linkTarget?.id ?? ''}
        displayName={linkTarget?.displayName ?? ''}
        open={!!linkTarget}
        onOpenChange={(open) => {
          if (!open) setLinkTarget(null)
        }}
      />
    </Card>
  )
}
