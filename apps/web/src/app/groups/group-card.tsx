import {
  Archive,
  ArchiveRestore,
  BanknoteArrowDown,
  BanknoteArrowUp,
  BanknoteCheck,
  Eye,
  EyeOff,
  MoreHorizontal,
  Star,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { AvatarStack } from '@/components/avatar-stack'
import Link from '@/components/link'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getCurrencyFromGroup } from '@/lib/currency'

import type { AccountGroup } from './group-buckets'

/**
 * Per-card minimum height shared with `CreateCard`. Both are designed to match
 * so the two-column grid renders tidy rows on `sm+` and a uniform stack on
 * mobile. Friend ledgers always have 2 participants, so the count row is hidden
 * on those and replaced by a placeholder that keeps the card height constant.
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
  const { t: tOverview } = useTranslation(undefined, {
    keyPrefix: 'Homepage.overview',
  })
  const { t: tBalances } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const { t: tStats } = useTranslation(undefined, { keyPrefix: 'Stats' })
  const isStarred = group.preference.starred
  const isHidden = group.preference.hidden
  const isArchived = group.archived
  const isFriend = group.groupType === 'FRIEND'
  const isPending = isFriend && group.memberCount === 1
  const memberAccounts = group.memberAccounts ?? []
  const currency = getCurrencyFromGroup(group.ledger)
  const financial = group.financialSummary ?? {
    expenseCount: 0,
    netBalance: null,
    state: 'UNAVAILABLE' as const,
    latestExpenseCreatedAt: null,
  }

  function renderFinancialSummary() {
    switch (financial.state) {
      case 'YOU_OWE':
        return (
          <span className="inline-flex items-center gap-1 font-medium text-destructive">
            <BanknoteArrowUp className="h-3.5 w-3.5" aria-hidden />
            <span>
              {tOverview('youOwe')}{' '}
              <Money
                currency={currency}
                amount={Math.abs(financial.netBalance ?? 0)}
              />
            </span>
          </span>
        )
      case 'OWED_TO_YOU':
        return (
          <span className="inline-flex items-center gap-1 font-medium text-green-600 dark:text-green-400">
            <BanknoteArrowDown className="h-3.5 w-3.5" aria-hidden />
            <span>
              {tOverview('youAreOwed')}{' '}
              <Money currency={currency} amount={financial.netBalance ?? 0} />
            </span>
          </span>
        )
      case 'SETTLED':
        return (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <BanknoteCheck className="h-3.5 w-3.5" aria-hidden />
            <span>{tBalances('direction.settledUp')}</span>
          </span>
        )
      case 'UNAVAILABLE':
        return (
          <span className="text-muted-foreground">{tBalances('title')}</span>
        )
      case 'NO_EXPENSES':
        return (
          <span className="text-muted-foreground">
            {tStats('Dashboard.emptyTitle')}
          </span>
        )
    }
  }

  return (
    <li key={group.id} className="min-w-0">
      <div
        className={`motion-surface motion-surface-interactive relative h-full w-full ${CARD_MIN_HEIGHT} cursor-pointer overflow-hidden rounded-lg border bg-card py-3 pr-1 pl-3 text-base shadow-xs hover:border-primary/25 hover:bg-muted/20`}
      >
        <div className="flex w-full flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-base">
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden font-medium text-ellipsis">
              {isFriend && group.friendAccount ? (
                <AccountAvatar account={group.friendAccount} size="md" />
              ) : null}
              <Link
                href={`/groups/${group.id}`}
                className="min-w-0 truncate text-foreground no-underline outline-hidden before:absolute before:inset-0 before:rounded-lg before:content-[''] focus-visible:underline"
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
            <span className="relative z-10 flex shrink-0 items-center">
              <Button
                size="icon"
                variant="ghost"
                className="-my-3 -mr-1.5 -ml-3"
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
                    className="h-4 w-4 text-orange-400"
                  />
                ) : (
                  <Star className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon"
                      variant="ghost"
                      className="-my-3 -mr-2 -ml-1.5"
                      onClick={(event) => event.stopPropagation()}
                      aria-label={
                        isFriend ? t('friendActions') : t('groupActions')
                      }
                    />
                  }
                >
                  <MoreHorizontal className="h-4 w-4" />
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
                        <Eye className="mr-2 h-4 w-4" />
                        {isFriend ? t('unhideFriend') : t('unhide')}
                      </>
                    ) : (
                      <>
                        <EyeOff className="mr-2 h-4 w-4" />
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
                          <ArchiveRestore className="mr-2 h-4 w-4" />
                          {t('unarchiveGroup')}
                        </>
                      ) : (
                        <>
                          <Archive className="mr-2 h-4 w-4" />
                          {t('archiveGroup')}
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
          <div className="text-xs font-normal text-muted-foreground">
            <div className="flex w-full items-center justify-between gap-2">
              {isFriend ? (
                // Friend ledgers always have two participants; reserve the
                // row height so the card matches sibling group cards.
                <span aria-hidden className="invisible">
                  <Users className="inline h-3 w-3" />
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <span>{group.memberCount}</span>
                  {memberAccounts.length > 0 && (
                    <AvatarStack
                      accounts={memberAccounts}
                      size="sm"
                      label={`${group.memberCount} members`}
                    />
                  )}
                </div>
              )}
              <div className="truncate">{renderFinancialSummary()}</div>
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}
