import { Link2, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CollapsibleSection } from '@/app/groups/collapsible-section'
import { Button } from '@/components/ui/button'
import { trpc } from '@/trpc/client'

import { LinkUnlinkedParticipantDialog } from './link-unlinked-participant-dialog'
import { ResponsiveParticipantActions } from './responsive-participant-actions'
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
  const linkFocusRef = useRef<HTMLButtonElement | null>(null)
  const actionTriggerRefs = useRef(new Map<string, HTMLButtonElement | null>())

  const openLinkDialog = (participant: {
    id: string
    displayName: string | null
  }) => {
    linkFocusRef.current = actionTriggerRefs.current.get(participant.id) ?? null
    setLinkTarget({
      id: participant.id,
      displayName: participant.displayName || t('unknownMember'),
    })
  }

  const unlinked = data?.unlinked ?? []
  if (isLoading || unlinked.length === 0) return null

  return (
    <CollapsibleSection
      defaultOpen={false}
      storageKey={`group-members-unlinked-${groupId}`}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{t('unlinked.title')}</span>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {unlinked.length}
          </span>
        </span>
      }
      contentClassName="pt-2"
    >
      <p className="mb-3 text-sm text-muted-foreground">
        {t('unlinked.description')}
      </p>
      <ul className="flex flex-col divide-y">
        {unlinked.map((p: { id: string; displayName: string | null }) => (
          <li
            key={p.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {p.displayName || t('unknownMember')}
              </p>
            </div>
            {canManage && (
              <ResponsiveParticipantActions
                label={t('actionsFor', {
                  name: p.displayName || t('unknownMember'),
                })}
                mobileTriggerRef={(element) => {
                  if (element) {
                    actionTriggerRefs.current.set(p.id, element)
                  } else {
                    actionTriggerRefs.current.delete(p.id)
                  }
                }}
                desktopActions={
                  <SegmentedActions>
                    <Button
                      ref={(element) => {
                        if (element) {
                          actionTriggerRefs.current.set(p.id, element)
                        } else {
                          actionTriggerRefs.current.delete(p.id)
                        }
                      }}
                      variant="ghost"
                      size="icon"
                      className="rounded-none"
                      aria-label={t('unlinked.linkButton')}
                      title={t('unlinked.linkButton')}
                      onClick={() => openLinkDialog(p)}
                    >
                      <Link2 size={16} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label={t('remove')}
                      title={t('remove')}
                      onClick={() =>
                        onRemove({
                          ledgerParticipantId: p.id,
                          name: p.displayName || t('unknownMember'),
                        })
                      }
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                  </SegmentedActions>
                }
                mobileActions={[
                  {
                    key: 'link',
                    label: t('unlinked.linkButton'),
                    icon: Link2,
                    onSelect: () => openLinkDialog(p),
                  },
                  {
                    key: 'remove',
                    label: t('remove'),
                    icon: Trash2,
                    destructive: true,
                    onSelect: () =>
                      onRemove({
                        ledgerParticipantId: p.id,
                        name: p.displayName || t('unknownMember'),
                      }),
                  },
                ]}
              />
            )}
          </li>
        ))}
      </ul>

      <LinkUnlinkedParticipantDialog
        groupId={groupId}
        unlinkedParticipantId={linkTarget?.id ?? ''}
        displayName={linkTarget?.displayName ?? ''}
        open={!!linkTarget}
        finalFocusRef={linkFocusRef}
        onOpenChange={(open) => {
          if (!open) setLinkTarget(null)
        }}
      />
    </CollapsibleSection>
  )
}
