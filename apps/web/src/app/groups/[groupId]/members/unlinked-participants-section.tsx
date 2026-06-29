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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LinkUnlinkedParticipantDialog } from './link-unlinked-participant-dialog'

export function UnlinkedParticipantsSection({
  groupId,
  canManage,
}: {
  groupId: string
  canManage: boolean
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLinkTarget({
                      id: p.id,
                      displayName: p.displayName || t('unknownMember'),
                    })
                  }
                >
                  {t('unlinked.linkButton')}
                </Button>
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
