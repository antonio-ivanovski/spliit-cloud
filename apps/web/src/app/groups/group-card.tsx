import { Link } from '@tanstack/react-router'
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
  Trash,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AccountAvatar } from '@/components/account-avatar'
import { AvatarStack } from '@/components/avatar-stack'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getCurrencyFromGroup } from '@/lib/currency'
import { GROUP_CARD_NEUTRAL, groupAccentStyle } from '@/lib/group-appearance'
import type { AppRouterOutput } from '@spliit/api/router'
import { displayEmoji } from '@spliit/domain'

import { isViewOnlyGroup, type AccountGroup } from './group-buckets'
import { ViewOnlyBadge } from './view-only-badge'

/**
 * Per-card minimum height shared with `CreateCard`. Both are designed to match
 * so the two-column grid renders tidy rows on `sm+` and a uniform stack on
 * mobile. Friend ledgers always have 2 participants, so the count row is hidden
 * on those and replaced by a placeholder that keeps the card height constant.
 */
const CARD_MIN_HEIGHT = 'min-h-[5.5rem]'

/**
 * Groups listed by `account.groups` (e.g. the import destination picker).
 * Carries the same identity visuals as `AccountGroup` (name, emoji, color,
 * members) but no financial summary or view-only access grant.
 */
type AccountGroupsItem = AppRouterOutput['account']['groups']['groups'][number]

export function GroupCard({
  group,
  onToggleStar,
  onToggleHidden,
  onToggleArchived,
  onRemoveSavedView,
  onSelect,
  hideFinancialSummary = false,
  stale = false,
}: {
  group: AccountGroup | AccountGroupsItem
  variant?: 'groups' | 'friends' | 'starred' | 'archived' | 'hidden'
  onToggleStar?: () => void
  onToggleHidden?: () => void
  onToggleArchived?: () => void
  onRemoveSavedView?: () => void
  /**
   * Selection mode for pickers (e.g. the import destination step): the card
   * behaves as a single button that selects the group — no navigation link, no
   * star/menu actions. Pair with `hideFinancialSummary` when balances are
   * irrelevant noise (the account-groups listing carries no summary).
   */
  onSelect?: (groupId: string) => void
  hideFinancialSummary?: boolean
  /** Offline dirty flag: last-known balances may be out of date. */
  stale?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tOverview } = useTranslation(undefined, {
    keyPrefix: 'Homepage.overview',
  })
  const { t: tBalances } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const { t: tStats } = useTranslation(undefined, { keyPrefix: 'Stats' })
  const { t: tOffline } = useTranslation()
  const isSelectable = onSelect !== undefined
  const isStarred = group.preference.starred
  const isHidden = group.preference.hidden
  const isArchived = group.archived
  const isFriend = group.groupType === 'FRIEND'
  const isPending = isFriend && group.memberCount === 1
  // Only home-listed groups carry an access grant; account-groups items never
  // do, so the `in` narrow keeps this false for them without a cast.
  const isViewOnly = 'access' in group && isViewOnlyGroup(group)
  const viewKey = 'viewKey' in group ? group.viewKey : undefined
  const showActionsMenu =
    !isSelectable &&
    (Boolean(onToggleHidden) ||
      Boolean(onToggleArchived && !isFriend) ||
      Boolean(onRemoveSavedView))
  const memberAccounts = group.memberAccounts ?? []
  const currency = getCurrencyFromGroup(group.ledger)
  const accent = groupAccentStyle(group.color)
  const emojiValue = displayEmoji(group.emoji)
  // Friend ledgers always get the rail so their geometry matches group cards;
  // groups only get it when they actually render an emoji.
  const showRail = isFriend || Boolean(emojiValue)
  // Account-groups items carry no financial summary; fall back to the
  // unavailable state (selection mode hides the row entirely anyway).
  const financial = ('financialSummary' in group
    ? group.financialSummary
    : undefined) ?? {
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

  const cardClassName = `motion-surface motion-surface-interactive relative flex h-full w-full ${CARD_MIN_HEIGHT} cursor-pointer overflow-hidden rounded-lg border bg-card pe-1 text-base shadow-xs ${
    accent ? 'group-accent-card' : GROUP_CARD_NEUTRAL
  }`

  // Shared body for both modes. Selection mode swaps the outer element for a
  // native button (free keyboard support, no role/key-handler lint issues);
  // the title link becomes a plain span so nothing nests interactively.
  const cardInner = (
    <>
      {showRail ? (
        <span
          aria-hidden="true"
          data-group-rail
          className={`grid w-12 shrink-0 place-items-center self-stretch ${
            accent
              ? 'group-accent-rail'
              : 'border-e border-border/60 bg-muted/30'
          }`}
        >
          {isFriend ? (
            group.friendAccount ? (
              <AccountAvatar account={group.friendAccount} size="lg" />
            ) : (
              <Users className="size-4 text-muted-foreground" />
            )
          ) : (
            <span data-group-emoji className="text-2xl leading-none">
              {emojiValue}
            </span>
          )}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-3 ps-3">
        <div className="flex items-center justify-between gap-2 text-base">
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden font-medium text-ellipsis">
            {isSelectable ? (
              <span
                className="min-w-0 truncate text-foreground"
                title={group.displayName}
              >
                {group.displayName}
              </span>
            ) : (
              <Link
                to="/groups/$groupId"
                params={{ groupId: group.id }}
                search={
                  isViewOnly && viewKey ? { viewKey: viewKey } : undefined
                }
                className="min-w-0 truncate text-foreground no-underline outline-hidden before:absolute before:inset-0 before:rounded-lg before:content-[''] focus-visible:underline"
                title={group.displayName}
              >
                {group.displayName}
              </Link>
            )}
            {isViewOnly && <ViewOnlyBadge />}
            {isPending && (
              <span className="ms-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground opacity-70">
                {t('pending')}
              </span>
            )}
          </span>
          <span className="relative z-10 flex shrink-0 items-center">
            {onToggleStar && !isSelectable ? (
              <Button
                size="icon"
                variant="ghost"
                className="-my-3 -ms-3 -me-1.5"
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
            ) : null}
            {showActionsMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon"
                      variant="ghost"
                      className="-my-3 -ms-1.5 -me-2"
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
                  {onToggleHidden ? (
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleHidden()
                      }}
                    >
                      {isHidden ? (
                        <>
                          <Eye className="me-2 h-4 w-4" />
                          {isFriend ? t('unhideFriend') : t('unhide')}
                        </>
                      ) : (
                        <>
                          <EyeOff className="me-2 h-4 w-4" />
                          {isFriend ? t('hideFriend') : t('hide')}
                        </>
                      )}
                    </DropdownMenuItem>
                  ) : null}
                  {onToggleArchived && !isFriend ? (
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleArchived()
                      }}
                    >
                      {isArchived ? (
                        <>
                          <ArchiveRestore className="me-2 h-4 w-4" />
                          {t('unarchiveGroup')}
                        </>
                      ) : (
                        <>
                          <Archive className="me-2 h-4 w-4" />
                          {t('archiveGroup')}
                        </>
                      )}
                    </DropdownMenuItem>
                  ) : null}
                  {onRemoveSavedView ? (
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.stopPropagation()
                        onRemoveSavedView()
                      }}
                    >
                      <Trash className="me-2 h-4 w-4" />
                      {t('removeSavedView')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
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
            {isViewOnly || hideFinancialSummary ? null : (
              <div className="truncate">{renderFinancialSummary()}</div>
            )}
          </div>
          {stale ? (
            <p
              className="mt-1 text-xs text-muted-foreground"
              role="note"
              data-testid={`group-card-stale-${group.id}`}
            >
              {tOffline('OfflineReadOnly.balancesStale')}
            </p>
          ) : null}
        </div>
      </div>
    </>
  )

  return (
    <li key={group.id} className="min-w-0">
      {isSelectable ? (
        <button
          type="button"
          onClick={() => onSelect(group.id)}
          style={accent ?? undefined}
          className={`${cardClassName} text-start`}
        >
          {cardInner}
        </button>
      ) : (
        <div style={accent ?? undefined} className={cardClassName}>
          {cardInner}
        </div>
      )}
    </li>
  )
}
