import { Link } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { shouldOfferGroupEmojiIntro } from '@/lib/group-appearance'
import { trpc } from '@/trpc/client'
import { detectEmojiInName } from '@spliit/domain'

import { useCurrentGroup } from './current-group-context'
import { useGroupAccessSearch } from './use-group-access-search'

/**
 * One-time nudge for existing groups whose name contains an emoji: announces
 * the appearance feature and links to settings, where the form prefills the
 * detected emoji. Dismissing persists the group-wide `''` sentinel via
 * `groups.dismissEmojiIntro`, so no admin is prompted again. Closing the dialog
 * any other way only hides it for this page visit — an accidental backdrop tap
 * must not permanently opt the group out.
 */
export function GroupEmojiIntroDialog() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups.emojiIntro' })
  const { groupId, group, currentMember, viewer, isLoading } = useCurrentGroup()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const [sessionDismissed, setSessionDismissed] = useState(false)
  const utils = trpc.useUtils()
  const dismissMutation = trpc.groups.dismissEmojiIntro.useMutation({
    onSuccess: () => {
      void utils.groups.get.invalidate()
      // The edit form reads groups.getDetails; a stale `null` there would
      // re-prefill the detected emoji and resurrect it on the next save.
      void utils.groups.getDetails.invalidate()
    },
  })

  const detectedEmoji = group ? detectEmojiInName(group.name) : null
  const eligible = shouldOfferGroupEmojiIntro({
    isLoading,
    groupType: group?.groupType,
    archived: group?.archived,
    groupName: group?.name,
    groupEmoji: group?.emoji,
    currentMemberRole: currentMember?.role,
    viewerAccess: viewer?.access,
  })
  const open = eligible && !sessionDismissed

  if (!group || !detectedEmoji) return null

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSessionDismissed(true)
      }}
    >
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('description', { emoji: detectedEmoji, name: group.name })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <div
            aria-hidden="true"
            className="mx-auto flex size-20 items-center justify-center rounded-2xl bg-muted text-4xl"
          >
            {detectedEmoji}
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-2">
          <Button
            variant="ghost"
            disabled={dismissMutation.isPending}
            onClick={() => {
              setSessionDismissed(true)
              dismissMutation.mutate({ groupId })
            }}
          >
            {t('notNow')}
          </Button>
          <Button
            nativeButton={false}
            render={
              <Link
                to="/groups/$groupId/edit"
                params={{ groupId }}
                search={{ invite: linkInviteToken, viewKey }}
              />
            }
            onClick={() => setSessionDismissed(true)}
          >
            {t('openSettings')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
