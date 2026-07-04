import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsPendingInvitee } from '../current-group-context'

export function ActiveUserModal({ groupId }: { groupId: string }) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'Expenses.ActiveUserModal',
  })
  const isPendingInvitee = useIsPendingInvitee()

  const [open, setOpen] = useState(() => {
    // The "active user" selector is a per-device legacy concept that is no
    // longer the source of truth (server-backed membership drives totals
    // and balances). Skip it for PENDING invitees — they have no
    // ledger participant id yet and the form is not useful.
    if (isPendingInvitee) return false

    const tempUser = localStorage.getItem(`newGroup-activeUser`)
    const activeUser = localStorage.getItem(`${groupId}-activeUser`)
    return !tempUser && !activeUser
  })
  const { data: groupData } = trpc.groups.get.useQuery({ groupId })

  const group = groupData?.group

  function updateOpen(nextOpen: boolean) {
    if (!nextOpen && !localStorage.getItem(`${groupId}-activeUser`)) {
      localStorage.setItem(`${groupId}-activeUser`, 'None')
    }
    setOpen(nextOpen)
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={updateOpen}>
      <ResponsiveDialogContent className="sm:max-w-[425px]">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <ActiveUserForm group={group} close={() => setOpen(false)} />
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter className="sm:justify-center pt-2">
          <p className="text-sm text-center text-muted-foreground">
            {t('footer')}
          </p>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function ActiveUserForm({
  group,
  close,
  className,
}: ComponentProps<'form'> & {
  group?: AppRouterOutput['groups']['get']['group']
  close: () => void
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'Expenses.ActiveUserModal',
  })
  const [selected, setSelected] = useState('None')

  return (
    <form
      className={cn('grid items-start gap-4', className)}
      onSubmit={(event) => {
        if (!group) return

        event.preventDefault()
        localStorage.setItem(`${group.id}-activeUser`, selected)
        close()
      }}
    >
      <RadioGroup defaultValue="none" onValueChange={setSelected}>
        <div className="flex flex-col gap-4 my-4">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="none" id="none" />
            <Label htmlFor="none" className="italic font-normal flex-1">
              {t('nobody')}
            </Label>
          </div>
          {group?.participants.map((participant) => (
            <div key={participant.id} className="flex items-center space-x-2">
              <RadioGroupItem value={participant.id} id={participant.id} />
              <Label htmlFor={participant.id} className="flex-1">
                {participant.name}
              </Label>
            </div>
          ))}
        </div>
      </RadioGroup>
      <Button type="submit">{t('save')}</Button>
    </form>
  )
}
