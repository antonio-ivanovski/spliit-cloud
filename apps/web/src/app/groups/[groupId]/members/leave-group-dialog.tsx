import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from 'react-i18next'

export function LeaveGroupDialog({
  leaveDialogOpen,
  leavePreviewQuery,
  leaveMutation,
  archiveForSelfMutation,
  isLastActiveMember,
  isAdminLeaving,
  hasUnsettledBalance,
  needsPromotion,
  otherAdmins,
  promotableMembers,
  promoteMemberId,
  confirmDeleteChecked,
  canConfirmLeave,
  preview,
  onOpenChange,
  onPromoteMemberChange,
  onConfirmDeleteChange,
  onConfirmLeave,
}: {
  leaveDialogOpen: boolean
  leavePreviewQuery: {
    isLoading: boolean
  }
  leaveMutation: { isPending: boolean }
  archiveForSelfMutation: { isPending: boolean }
  isLastActiveMember: boolean
  isAdminLeaving: boolean
  hasUnsettledBalance: boolean
  needsPromotion: boolean
  otherAdmins: Array<{ id: string; name: string }>
  promotableMembers: Array<{ id: string; name: string }>
  promoteMemberId: string | null
  confirmDeleteChecked: boolean
  canConfirmLeave: boolean
  preview: unknown
  onOpenChange: (open: boolean) => void
  onPromoteMemberChange: (id: string) => void
  onConfirmDeleteChange: (checked: boolean) => void
  onConfirmLeave: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  return (
    <Dialog
      open={leaveDialogOpen}
      onOpenChange={(open) => {
        if (!open && leaveMutation.isPending) return
        onOpenChange(open)
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('leave.title')}</DialogTitle>
          <DialogDescription>{t('leave.description')}</DialogDescription>
        </DialogHeader>

        {leavePreviewQuery.isLoading || !preview ? (
          <div className="flex flex-col gap-3 py-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {isAdminLeaving && otherAdmins.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('leave.body.otherAdmins', {
                  names: otherAdmins
                    .map((admin) => admin.name || '—')
                    .join(', '),
                })}
              </p>
            )}

            {needsPromotion && (
              <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
                <p className="text-sm font-medium">
                  {t('leave.body.lastAdmin.title')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('leave.body.lastAdmin.description')}
                </p>
                <div className="flex flex-col gap-1.5 pt-1">
                  <Label htmlFor="promote-member">
                    {t('leave.body.lastAdmin.title')}
                  </Label>
                  <Select
                    value={promoteMemberId ?? ''}
                    onValueChange={(value) => onPromoteMemberChange(value)}
                    disabled={leaveMutation.isPending}
                  >
                    <SelectTrigger id="promote-member">
                      <SelectValue
                        placeholder={t('leave.body.lastAdmin.placeholder')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {promotableMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name || '—'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {hasUnsettledBalance && !isLastActiveMember && (
              <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
                <p className="text-sm font-medium">
                  {t('leave.body.unsettled.title')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('leave.body.unsettled.description')}
                </p>
              </div>
            )}

            {isLastActiveMember && (
              <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">
                  {t('leave.body.lastMember.title')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('leave.body.lastMember.description')}
                </p>
                {hasUnsettledBalance && (
                  <p className="text-sm text-muted-foreground">
                    {t('leave.body.lastMember.unsettledInfo')}
                  </p>
                )}
                <label className="flex items-start gap-2 pt-1 text-sm cursor-pointer">
                  <Checkbox
                    checked={confirmDeleteChecked}
                    onCheckedChange={(checked) =>
                      onConfirmDeleteChange(checked === true)
                    }
                    disabled={leaveMutation.isPending}
                    className="mt-0.5"
                  />
                  <span>{t('leave.body.lastMember.checkbox')}</span>
                </label>
                <p className="text-xs text-muted-foreground pt-2 border-t border-destructive/20">
                  {t('leave.body.lastMember.suggestion')}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={
              leaveMutation.isPending || archiveForSelfMutation.isPending
            }
          >
            {t('leave.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirmLeave}
            disabled={!canConfirmLeave}
          >
            {isLastActiveMember && preview
              ? t('leave.confirmDelete')
              : hasUnsettledBalance && preview
                ? t('leave.confirmWithForce')
                : t('leave.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
