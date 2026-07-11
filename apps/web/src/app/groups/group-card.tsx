import { AccountAvatar } from '@/components/account-avatar'
import { AvatarStack } from '@/components/avatar-stack'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLocale } from '@/i18n/react'
import {
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
  MoreHorizontal,
  Star,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AccountGroup } from './group-buckets'

/**
 * Per-card minimum height shared with `CreateCard`. Both are designed to
 * match so the two-column grid renders tidy rows on `sm+` and a uniform
 * stack on mobile. Friend ledgers always have 2 participants, so the count
 * row is hidden on those and replaced by a placeholder that keeps the
 * card height constant.
 */
const CARD_MIN_HEIGHT = 'min-h-[5.5rem]'

export function GroupCard({
  group,
  onToggleStar,
  onToggleHidden,
  onToggleArchived,
}: {
  group: AccountGroup
  variant?: 'groups' | 'friends' | 'starred' | 'archived' | 'hidden'
  onToggleStar: () => void
  onToggleHidden: () => void
  onToggleArchived?: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const locale = useLocale()
  const isStarred = group.preference.starred
  const isHidden = group.preference.hidden
  const isArchived = group.archived
  const isFriend = group.groupType === 'FRIEND'
  const isPending = isFriend && group._count.members === 1
  const memberAccounts = group.memberAccounts ?? []
  const formattedDate = new Date(group.createdAt).toLocaleDateString(locale, {
    dateStyle: 'medium',
  })

  return (
    <li key={group.id} className="min-w-0">
      <div
        className={`relative w-full h-full ${CARD_MIN_HEIGHT} cursor-pointer py-3 pl-3 pr-1 rounded-lg border bg-card shadow-xs text-base overflow-hidden transition-[border-color,box-shadow,background-color,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-muted/20 hover:shadow-sm`}
      >
        <div className="w-full flex flex-col gap-1">
          <div className="text-base flex gap-2 justify-between items-center">
            <span className="flex-1 overflow-hidden text-ellipsis font-medium min-w-0 flex items-center gap-2">
              {isFriend && group.friendAccount ? (
                <AccountAvatar account={group.friendAccount} size="md" />
              ) : null}
              <Link
                href={`/groups/${group.id}`}
                className="text-foreground no-underline outline-hidden focus-visible:underline before:absolute before:inset-0 before:rounded-lg before:content-[''] min-w-0 truncate"
                title={group.displayName}
              >
                {group.displayName}
              </Link>
              {isPending && (
                <span className="ml-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground opacity-70">
                  {t('pending')}
                </span>
              )}
            </span>
            <span className="shrink-0 relative z-10 flex items-center">
              <Button
                size="icon"
                variant="ghost"
                className="-my-3 -ml-3 -mr-1.5"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleStar()
                }}
                aria-label={
                  isStarred
                    ? isFriend
                      ? t('unstarFriend')
                      : t('unstarGroup')
                    : isFriend
                      ? t('starFriend')
                      : t('starGroup')
                }
              >
                {isStarred ? (
                  <Star
                    fill="currentColor"
                    className="w-4 h-4 text-orange-400"
                  />
                ) : (
                  <Star className="w-4 h-4 text-muted-foreground" />
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="-my-3 -mr-2 -ml-1.5"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={
                      isFriend ? t('friendActions') : t('groupActions')
                    }
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleHidden()
                    }}
                  >
                    {isHidden ? (
                      <>
                        <Eye className="w-4 h-4 mr-2" />
                        {isFriend ? t('unhideFriend') : t('unhide')}
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-4 h-4 mr-2" />
                        {isFriend ? t('hideFriend') : t('hide')}
                      </>
                    )}
                  </DropdownMenuItem>
                  {onToggleArchived && !isFriend && (
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleArchived()
                      }}
                    >
                      {isArchived ? (
                        <>
                          <ArchiveRestore className="w-4 h-4 mr-2" />
                          {t('unarchiveGroup')}
                        </>
                      ) : (
                        <>
                          <Archive className="w-4 h-4 mr-2" />
                          {t('archiveGroup')}
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
          <div className="text-muted-foreground font-normal text-xs">
            <div className="w-full flex items-center justify-between gap-2">
              {isFriend ? (
                // Friend ledgers always have two participants; reserve the
                // row height so the card matches sibling group cards.
                <span aria-hidden className="invisible">
                  <Users className="w-3 h-3 inline" />
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <span>{group._count.members}</span>
                  {memberAccounts.length > 0 && (
                    <AvatarStack
                      accounts={memberAccounts}
                      size="sm"
                      label={`${group._count.members} members`}
                    />
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5 truncate">
                <span className="truncate">{formattedDate}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}
