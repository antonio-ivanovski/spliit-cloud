import { Link, useLocation } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useStartupTimeZoneCheck } from '@/components/account-preferences-sync'
import { isPushOnboardingActive } from '@/components/push-notification-onboarding'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnboardingStatus } from '@/lib/use-onboarding-status'
import { trpc } from '@/trpc/client'
import { getAnnouncementContent } from '@spliit/domain/announcements'

import { formatAnnouncementDate } from './announcement-body'
import { UpdatesContent } from './updates-content'

export function UpdatesModal() {
  const { t, i18n } = useTranslation()
  const pathname = useLocation({ select: (location) => location.pathname })
  const { data: account, isPending, error } = useCurrentAccount()
  const { needsOnboarding } = useOnboardingStatus()
  const timeZoneCheck = useStartupTimeZoneCheck()
  const utils = trpc.useUtils()
  const status = trpc.announcements.latestStatus.useQuery(undefined, {
    enabled: !!account && !isPending && !error && !needsOnboarding,
  })
  const markViewed = trpc.announcements.markViewed.useMutation()
  const [open, setOpen] = useState(false)
  const dismissed = useRef<string | null>(null)
  const content = status.data?.announcementId
    ? getAnnouncementContent(status.data.announcementId, i18n.language)
    : undefined
  const announcementId = content?.id

  useEffect(() => {
    if (
      !content ||
      status.data?.viewed ||
      dismissed.current === content.id ||
      pathname.startsWith('/auth/') ||
      pathname === '/updates' ||
      !timeZoneCheck.checked ||
      timeZoneCheck.promptActive
    )
      return
    let timer: number
    const check = () => {
      if (
        isPushOnboardingActive() ||
        document.querySelector('[role="dialog"]')
      ) {
        timer = window.setTimeout(check, 500)
      } else {
        setOpen(true)
      }
    }
    timer = window.setTimeout(check, 1500)
    return () => window.clearTimeout(timer)
  }, [
    content,
    status.data?.viewed,
    pathname,
    timeZoneCheck.checked,
    timeZoneCheck.promptActive,
  ])

  if (!content || !announcementId) return null

  function close() {
    dismissed.current = content!.id
    setOpen(false)
    void markViewed
      .mutateAsync({ announcementId: content!.id })
      .then(() => utils.announcements.latestStatus.invalidate())
      .catch(() => {
        // A failed save leaves this announcement unseen for the next visit.
      })
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <ResponsiveDialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <ResponsiveDialogHeader className="px-4 pt-4 pb-2 sm:px-6 sm:pt-6">
          <p className="text-xs font-medium tracking-wide text-primary uppercase">
            {t('Updates.latest')} ·{' '}
            {formatAnnouncementDate(content.date, i18n.language)}
          </p>
          <ResponsiveDialogTitle>{content.title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="max-h-[min(65vh,36rem)] overflow-y-auto px-4 py-4 sm:px-6">
          <UpdatesContent announcementId={content.id} />
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter className="px-4 pt-2 pb-4 sm:px-6 sm:pb-6">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/updates" onClick={close} />}
          >
            {t('Updates.viewAll')}
          </Button>
          <Button onClick={close}>{t('Updates.dismiss')}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
