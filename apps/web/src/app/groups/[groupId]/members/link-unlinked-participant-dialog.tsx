'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Server-filtered "link to account" picker. The candidates procedure
 * excludes the unlinked LP itself and any LP on the opposite side of
 * an expense leg, so the admin only sees compatible destinations and
 * never hits the unique-constraint error from the old inline form.
 */
export function LinkUnlinkedParticipantDialog({
  groupId,
  unlinkedParticipantId,
  displayName,
  open,
  onOpenChange,
}: {
  groupId: string
  unlinkedParticipantId: string
  displayName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })
  const { toast } = useToast()
  const utils = trpc.useUtils()

  const candidatesQuery = trpc.groups.importLinks.candidates.useQuery(
    { unlinkedParticipantId },
    { enabled: open, staleTime: 0, refetchOnMount: 'always' },
  )

  const linkMutation = trpc.groups.importLinks.link.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.groups.importLinks.listUnlinked.invalidate({ groupId }),
        utils.account.members.invalidate(),
        utils.groups.get.invalidate({ groupId }),
        utils.groups.balances.list.invalidate({ groupId }),
      ])
      toast({ description: t('unlinked.linkSuccess') })
      onOpenChange(false)
    },
    onError: (err) => {
      toast({ description: err.message, variant: 'destructive' })
    },
  })

  const candidates = candidatesQuery.data?.candidates ?? []

  const members = candidates.filter((c) => c.kind === 'MEMBER')
  const pending = candidates.filter((c) => c.kind === 'PENDING')

  const [selected, setSelected] = useState<string | null>(null)
  const selectedCandidate = candidates.find((c) => c.id === selected) ?? null

  function handleConfirm() {
    if (!selectedCandidate || !selectedCandidate.email) return
    linkMutation.mutate({
      groupId,
      ledgerParticipantId: unlinkedParticipantId,
      email: selectedCandidate.email,
      pendingInvitationId:
        selectedCandidate.kind === 'PENDING'
          ? (selectedCandidate.invitationId ?? undefined)
          : undefined,
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSelected(null)
      linkMutation.reset()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('unlinked.linkDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('unlinked.linkDialog.description', { displayName })}
          </DialogDescription>
        </DialogHeader>

        {candidatesQuery.isLoading ? (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {t('unlinked.linkDialog.noCandidates')}
          </p>
        ) : (
          <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
            {members.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('unlinked.linkDialog.membersGroup')}
                </p>
                <div className="flex flex-col divide-y rounded-md border">
                  {members.map((candidate) => {
                    const checked = selected === candidate.id
                    return (
                      <label
                        key={candidate.id}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 disabled:cursor-not-allowed"
                      >
                        <input
                          type="radio"
                          name="link-unlinked-candidate"
                          value={candidate.id}
                          checked={checked}
                          disabled={linkMutation.isPending}
                          onChange={() => setSelected(candidate.id)}
                          className="h-4 w-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">
                            {candidate.name}
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {candidate.email}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            {pending.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('unlinked.linkDialog.pendingGroup')}
                </p>
                <div className="flex flex-col divide-y rounded-md border">
                  {pending.map((candidate) => {
                    const checked = selected === candidate.id
                    return (
                      <label
                        key={candidate.id}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 disabled:cursor-not-allowed"
                      >
                        <input
                          type="radio"
                          name="link-unlinked-candidate"
                          value={candidate.id}
                          checked={checked}
                          disabled={linkMutation.isPending}
                          onChange={() => setSelected(candidate.id)}
                          className="h-4 w-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="block text-sm font-medium truncate">
                              {candidate.name}
                            </span>
                            <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {t('unlinked.linkDialog.pendingSuffix')}
                            </span>
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {candidate.email}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                {selectedCandidate?.kind === 'PENDING' && (
                  <p className="text-xs text-muted-foreground">
                    {t('unlinked.linkDialog.pendingHint')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={linkMutation.isPending}
          >
            {t('unlinked.linkDialog.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              linkMutation.isPending ||
              candidatesQuery.isLoading ||
              !selectedCandidate
            }
          >
            {t('unlinked.linkDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
