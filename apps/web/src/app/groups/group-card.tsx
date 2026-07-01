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

export function GroupCard({
  group,
  onToggleStar,
  onToggleHidden,
  onToggleArchived,
}: {
  group: AccountGroup
  variant: 'active' | 'archived' | 'hidden'
  onToggleStar: () => void
  onToggleHidden: () => void
  onToggleArchived?: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const locale = useLocale()
  const isStarred = group.preference.starred
  const isHidden = group.preference.hidden
  const isArchived = group.archived

  return (
    <li key={group.id}>
      <div className="relative h-fit w-full py-3 pl-3 pr-1 rounded-lg border bg-card shadow-xs text-base">
        <div className="w-full flex flex-col gap-1">
          <div className="text-base flex gap-2 justify-between items-center">
            <span className="flex-1 overflow-hidden text-ellipsis font-medium min-w-0">
              <Link
                href={`/groups/${group.id}`}
                className="text-foreground no-underline outline-hidden focus-visible:underline before:absolute before:inset-0 before:rounded-lg before:content-['']"
                title={group.name}
              >
                {group.name}
              </Link>
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
                aria-label={isStarred ? t('unstarGroup') : t('starGroup')}
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
                    aria-label={t('groupActions')}
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
                        {t('unhide')}
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-4 h-4 mr-2" />
                        {t('hide')}
                      </>
                    )}
                  </DropdownMenuItem>
                  {onToggleArchived && (
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
            <div className="w-full flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Users className="w-3 h-3 inline" />
                <span>{group._count.members}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span>
                  {new Date(group.createdAt).toLocaleDateString(locale, {
                    dateStyle: 'medium',
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}
