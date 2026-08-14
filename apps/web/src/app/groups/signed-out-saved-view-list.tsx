import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useToast } from '@/components/ui/use-toast'
import { removeDeviceView, useDeviceSavedViews } from '@/lib/saved-view-groups'

import { savedViewToAccountGroup } from './group-buckets'
import { GroupCard } from './group-card'

export function SignedOutSavedGroupsEntry() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const views = useDeviceSavedViews()

  if (views.length === 0) return null

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="link"
        className="h-auto self-center p-0 text-sm font-semibold text-sky-800 lg:self-start dark:text-sky-200"
        onClick={() => setOpen(true)}
      >
        {t('Homepage.savedGroupsAction')}
      </Button>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader className="text-start">
          <ResponsiveDialogTitle>
            {t('Homepage.savedGroupsTitle')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('Homepage.savedGroupsDescription')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <SignedOutSavedViewList />
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

export function SignedOutSavedViewList() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { toast } = useToast()
  const views = useDeviceSavedViews()

  if (views.length === 0) return null

  return (
    <ul className="motion-stagger grid items-stretch gap-3 sm:grid-cols-2">
      {views.map((view) => {
        const group = savedViewToAccountGroup(view)
        return (
          <GroupCard
            key={view.groupId}
            group={group}
            onRemoveSavedView={() => {
              removeDeviceView(view.groupId)
              toast({ description: t('removeSavedViewDevice') })
            }}
          />
        )
      })}
    </ul>
  )
}
