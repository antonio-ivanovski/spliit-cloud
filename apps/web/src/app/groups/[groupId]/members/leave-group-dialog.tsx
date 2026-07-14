import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from 'react-i18next'

/**
 * Leave-group dialog. Renders one of three shapes:
 *   - last-admin promotion picker when the caller is the last admin
 *     and other members exist,
 *   - unsettled-balance warning when the caller has non-zero balances,
 *   - the simple confirm otherwise.
 *
 * The "last active member" branch is intentionally absent: the dedicated
 * delete flow on the settings page is now the only way to leave a group
 * with a single member, so the leave dialog never renders for that case.
 */
// react-doctor-disable-next-line react-doctor/no-many-boolean-props -- independent section flags, not mutually-exclusive variants
export function LeaveGroupDialog({
  leaveDialogOpen,
  leavePreviewQuery,
  leaveMutation,
  isLastActiveMember,
  isAdminLeaving,
  hasUnsettledBalance,
  needsPromotion,
  otherAdmins,
  promotableMembers,
  promoteMemberId,
  canConfirmLeave,
  preview,
  onOpenChange,
  onPromoteMemberChange,
  onConfirmLeave,
}: {
  leaveDialogOpen: boolean
  leavePreviewQuery: {
    isLoading: boolean
  }
  leaveMutation: { isPending: boolean }
  isLastActiveMember: boolean
  isAdminLeaving: boolean
  hasUnsettledBalance: boolean
  needsPromotion: boolean
  otherAdmins: Array<{ id: string; name: string }>
  promotableMembers: Array<{ id: string; name: string }>
  promoteMemberId: string | null
  canConfirmLeave: boolean
  preview: unknown
  onOpenChange: (open: boolean) => void
  onPromoteMemberChange: (id: string) => void
  onConfirmLeave: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Members' })

  return (
    <ResponsiveDialog
      open={leaveDialogOpen}
      onOpenChange={(open) => {
        if (!open && leaveMutation.isPending) return
        onOpenChange(open)
      }}
    >
      <ResponsiveDialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('leave.title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('leave.description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          {leavePreviewQuery.isLoading || !preview ? (
            <div className="flex flex-col gap-3 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Last-active-member is blocked at the API level and the
                  Leave button is disabled, but keep this guard so the
                  dialog can't render a misleading copy if it ever opens
                  with stale preview data. */}
              {isLastActiveMember ? (
                <p className="text-sm text-muted-foreground">
                  {t('leave.lastMemberRedirect')}
                </p>
              ) : (
                <>
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
                          onValueChange={(value) =>
                            onPromoteMemberChange(value)
                          }
                          disabled={leaveMutation.isPending}
                        >
                          <SelectTrigger id="promote-member">
                            <SelectValue
                              placeholder={t(
                                'leave.body.lastAdmin.placeholder',
                              )}
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

                  {hasUnsettledBalance && (
                    <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3">
                      <p className="text-sm font-medium">
                        {t('leave.body.unsettled.title')}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t('leave.body.unsettled.description')}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={leaveMutation.isPending}
          >
            {t('leave.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirmLeave}
            disabled={!canConfirmLeave || isLastActiveMember}
          >
            {hasUnsettledBalance && preview
              ? t('leave.confirmWithForce')
              : t('leave.confirm')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
