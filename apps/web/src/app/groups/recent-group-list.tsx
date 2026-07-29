import {
  AlertCircle,
  BanknoteArrowDown,
  BanknoteArrowUp,
  BanknoteCheck,
  ChevronRight,
  Cloud,
  Loader2,
  Plus,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CurrencyConverterButton } from '@/components/currency-converter/currency-converter'
import Link from '@/components/link'
import { Money } from '@/components/money'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useToast } from '@/components/ui/use-toast'
import { getCurrencyFromGroup } from '@/lib/currency'
import { useMediaQuery } from '@/lib/hooks'
import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { useCurrentAccount } from '@/lib/use-current-account'
import { trpc } from '@/trpc/client'

import { CollapsibleSection } from './collapsible-section'
import { CreateCard } from './create-card'
import { ForceArchiveDialogSection } from './force-archive-dialog-section'
import type { AccountGroup } from './group-buckets'
import { partitionGroups } from './group-buckets'
import { GroupCard } from './group-card'
import { PendingInvitations } from './pending-invitations'

const STORAGE_KEYS = {
  starred: 'spliit:home:section:starred',
  groups: 'spliit:home:section:groups',
  friends: 'spliit:home:section:friends',
  archived: 'spliit:home:section:archived',
  hidden: 'spliit:home:section:hidden',
} as const

export function RecentGroupList() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tStats } = useTranslation(undefined, { keyPrefix: 'Stats' })
  const { data: account } = useCurrentAccount()
  const utils = trpc.useUtils()
  const { data, error, isLoading, refetch } =
    trpc.overview.get.useQuery(undefined)
  const [forceArchiveTarget, setForceArchiveTarget] =
    useState<AccountGroup | null>(null)
  const { mutateAsync: setPreference } =
    trpc.account.setPreference.useMutation()
  const { mutateAsync: archiveGroup } = trpc.groups.archive.useMutation()
  const { toast } = useToast()

  async function updatePreference(
    groupId: string,
    patch: Partial<AccountGroup['preference']>,
  ) {
    await setPreference({ groupId, ...patch })
    await invalidateAccountGroupLists(utils)
  }

  async function archiveGroupWithBalancesCheck(
    group: AccountGroup,
    nextArchived: boolean,
  ) {
    try {
      await archiveGroup({ groupId: group.id, archived: nextArchived })
      await Promise.all([
        invalidateAccountGroupLists(utils),
        utils.groups.get.invalidate({ groupId: group.id }),
      ])
      toast({
        description: nextArchived ? t('archiveSuccess') : t('unarchiveSuccess'),
      })
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'data' in error &&
        (error as { data?: { code?: string } }).data?.code ===
          'PRECONDITION_FAILED'
      ) {
        setForceArchiveTarget(group)
        return
      }
      toast({
        description:
          error instanceof Error
            ? error.message
            : t('archiveWithBalancesCancel'),
        variant: 'destructive',
      })
    }
  }

  async function toggleArchived(group: AccountGroup) {
    await archiveGroupWithBalancesCheck(group, !group.archived)
  }

  const isGroupsLoading = isLoading
  const allGroups = data?.groups ?? []

  function renderGroupItems(
    list: AccountGroup[],
    variant: 'groups' | 'archived' | 'hidden' | 'friends' | 'starred',
  ) {
    return (
      <>
        {list.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            variant={variant}
            onToggleStar={() =>
              updatePreference(group.id, {
                starred: !group.preference.starred,
              })
            }
            onToggleHidden={() =>
              updatePreference(group.id, {
                hidden: !group.preference.hidden,
              })
            }
            onToggleArchived={
              variant !== 'friends' &&
              variant !== 'hidden' &&
              group.currentMemberRole === 'ADMIN' &&
              group.groupType !== 'FRIEND'
                ? () => toggleArchived(group)
                : undefined
            }
          />
        ))}
      </>
    )
  }

  let body: React.ReactNode
  if (isGroupsLoading) {
    body = (
      <div className="flex items-center justify-center rounded-lg border bg-card py-10 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('loadingRecent')}
      </div>
    )
  } else if (error) {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card px-4 py-10 text-center">
        <AlertCircle className="h-5 w-5 text-destructive" aria-hidden />
        <p className="text-sm text-muted-foreground">
          {tStats('Dashboard.error')}
        </p>
        <button
          type="button"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => void refetch()}
        >
          {tStats('Dashboard.retry')}
        </button>
      </div>
    )
  } else {
    const {
      groups: sectionGroups,
      friends,
      starred,
      archived,
      hidden,
    } = partitionGroups(allGroups)

    body = (
      <div className="flex flex-col gap-5">
        {starred.length > 0 && (
          <CollapsibleSection
            storageKey={STORAGE_KEYS.starred}
            defaultOpen
            title={t('starred')}
          >
            <ul className="motion-stagger grid items-stretch gap-3 sm:grid-cols-2">
              {renderGroupItems(starred, 'starred')}
            </ul>
          </CollapsibleSection>
        )}

        <CollapsibleSection
          storageKey={STORAGE_KEYS.groups}
          defaultOpen
          title={t('groups')}
        >
          <ul className="motion-stagger grid items-stretch gap-3 sm:grid-cols-2">
            <CreateCard
              href="/groups/create"
              icon={<Plus className="h-4 w-4" />}
              title={t('createGroupCard.title')}
              description={t('createGroupCard.description')}
              data-testid="create-group-card"
              secondaryAction={{
                href: '/groups/import',
                icon: <Cloud className="h-4 w-4" />,
                label: t('importGroup'),
                'data-testid': 'import-group-action',
              }}
            />
            {renderGroupItems(sectionGroups, 'groups')}
          </ul>
        </CollapsibleSection>

        <CollapsibleSection
          storageKey={STORAGE_KEYS.friends}
          defaultOpen
          title={t('friends')}
        >
          <ul className="motion-stagger grid items-stretch gap-3 sm:grid-cols-2">
            <CreateCard
              href="/friends/create"
              icon={<Users className="h-4 w-4" />}
              title={t('createFriendLedgerCard.title')}
              description={t('createFriendLedgerCard.description')}
              data-testid="create-friend-ledger-card"
            />
            {renderGroupItems(friends, 'friends')}
          </ul>
        </CollapsibleSection>

        {archived.length > 0 && (
          <CollapsibleSection
            storageKey={STORAGE_KEYS.archived}
            defaultOpen={false}
            title={t('archived')}
          >
            <ul className="motion-stagger grid items-stretch gap-3 opacity-60 sm:grid-cols-2">
              {renderGroupItems(archived, 'archived')}
            </ul>
          </CollapsibleSection>
        )}

        {hidden.length > 0 && (
          <CollapsibleSection
            storageKey={STORAGE_KEYS.hidden}
            defaultOpen={false}
            title={t('hidden')}
          >
            <ul className="motion-stagger grid items-stretch gap-3 opacity-60 sm:grid-cols-2">
              {renderGroupItems(hidden, 'hidden')}
            </ul>
          </CollapsibleSection>
        )}
      </div>
    )
  }

  return (
    <>
      <OverviewHeader
        name={account?.name}
        stats={data?.stats}
        groups={allGroups}
      />
      <PendingInvitations />
      {body}
      <ForceArchiveDialogSection
        target={forceArchiveTarget}
        onClose={() => setForceArchiveTarget(null)}
      />
    </>
  )
}

function OverviewHeader({
  name,
  stats,
  groups,
}: {
  name?: string
  groups: AccountGroup[]
  stats:
    | {
        balanceSummaries: Array<{
          currency: string
          currencyCode: string | null
          owedToYou: number
          owedToYouGroupCount: number
          youOwe: number
          youOweGroupCount: number
        }>
        friendCount: number
      }
    | undefined
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Homepage' })
  const { t: tBalances } = useTranslation(undefined, { keyPrefix: 'Balances' })
  const { t: tLabels } = useTranslation(undefined, {
    keyPrefix: 'EmptyState.labels',
  })
  const balanceSummaries = stats?.balanceSummaries ?? []
  const hasGroupSummary =
    balanceSummaries.length > 0 ||
    (stats?.friendCount ?? 0) > 0 ||
    groups.length > 0
  const hasAnyBalance = balanceSummaries.some(
    (summary) => summary.owedToYou > 0 || summary.youOwe > 0,
  )

  function groupLabel(count: number) {
    return tLabels(count === 1 ? 'group' : 'groupPlural')
  }

  return (
    <section className="flex flex-col gap-3" aria-label={tBalances('title')}>
      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold tracking-tight sm:text-xl">
          {t('welcomeBack', { name: name ?? '' })}
        </p>
        <CurrencyConverterButton />
      </div>
      {stats && hasGroupSummary ? (
        <div className="rounded-lg border bg-card px-4 py-3 shadow-xs sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b pb-3">
            <p className="text-sm font-medium">{t('overview.acrossGroups')}</p>
            {stats.friendCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {stats.friendCount}{' '}
                {stats.friendCount === 1
                  ? tLabels('friendLedger')
                  : tLabels('friendLedgerPlural')}
              </span>
            )}
          </div>
          <div className="grid gap-3 pt-3 sm:grid-cols-2">
            <BalanceDirection
              direction="owed"
              summaries={balanceSummaries}
              groups={groups}
              groupLabel={groupLabel}
              label={t('overview.youAreOwed')}
            />
            <BalanceDirection
              direction="owe"
              summaries={balanceSummaries}
              groups={groups}
              groupLabel={groupLabel}
              label={t('overview.youOwe')}
            />
          </div>
          {!hasAnyBalance && (
            <div className="mt-3 flex items-center justify-center gap-2 border-t pt-3 text-sm text-muted-foreground">
              <BanknoteCheck className="h-4 w-4" aria-hidden />
              <span>{tBalances('direction.settledUp')}</span>
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

function BalanceDirection({
  direction,
  summaries,
  groups,
  groupLabel,
  label,
}: {
  direction: 'owed' | 'owe'
  summaries: Array<{
    currency: string
    currencyCode: string | null
    owedToYou: number
    owedToYouGroupCount: number
    youOwe: number
    youOweGroupCount: number
  }>
  groups: AccountGroup[]
  groupLabel: (count: number) => string
  label: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Homepage' })
  const isOwed = direction === 'owed'
  const rows = summaries.filter((summary) =>
    isOwed ? summary.owedToYou > 0 : summary.youOwe > 0,
  )
  const Icon = isOwed ? BanknoteArrowDown : BanknoteArrowUp
  return (
    <div className="min-w-0">
      <div
        className={`mb-2 flex items-center gap-1.5 text-sm font-medium ${
          isOwed ? 'text-green-600 dark:text-green-400' : 'text-destructive'
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden />
        <span>{label}</span>
      </div>
      {rows.length > 0 ? (
        <div className="grid gap-1.5">
          {rows.map((summary) => (
            <BalanceSummaryRow
              key={`${summary.currencyCode ?? summary.currency}-${direction}`}
              direction={direction}
              summary={summary}
              groups={groups}
              groupLabel={groupLabel}
              label={label}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
          {t(isOwed ? 'overview.noOneOwesYou' : 'overview.youOweNoOne')}
        </div>
      )}
    </div>
  )
}

function BalanceSummaryRow({
  direction,
  summary,
  groups,
  groupLabel,
  label,
}: {
  direction: 'owed' | 'owe'
  summary: {
    currency: string
    currencyCode: string | null
    owedToYou: number
    owedToYouGroupCount: number
    youOwe: number
    youOweGroupCount: number
  }
  groups: AccountGroup[]
  groupLabel: (count: number) => string
  label: string
}) {
  const isOwed = direction === 'owed'
  const currency = getCurrencyFromGroup(summary)
  const amount = isOwed ? summary.owedToYou : summary.youOwe
  const contributingGroups = groups.filter((group) => {
    const netBalance = group.financialSummary.netBalance
    return (
      group.ledger.currency === summary.currency &&
      group.ledger.currencyCode === summary.currencyCode &&
      netBalance !== null &&
      (isOwed ? netBalance > 0 : netBalance < 0)
    )
  })
  const groupCount = contributingGroups.length

  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2">
      <Money currency={currency} amount={amount} bold />
      <BalanceGroupBreakdown
        label={label}
        amount={amount}
        currency={currency}
        groups={contributingGroups}
        groupCount={groupCount}
        groupLabel={groupLabel}
      />
    </div>
  )
}

function BalanceGroupBreakdown({
  label,
  amount,
  currency,
  groups,
  groupCount,
  groupLabel,
}: {
  label: string
  amount: number
  currency: ReturnType<typeof getCurrencyFromGroup>
  groups: AccountGroup[]
  groupCount: number
  groupLabel: (count: number) => string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Homepage' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const [open, setOpen] = useState(false)
  const trigger = (
    <button
      type="button"
      className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      aria-label={t('overview.viewGroups')}
    >
      <span>
        {groupCount} {groupLabel(groupCount)}
      </span>
      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
  const title = (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium">{label}</span>
      <Money currency={currency} amount={amount} bold />
    </div>
  )
  const list = (
    <ul className="grid gap-1.5">
      {groups.map((group) => {
        const netBalance = group.financialSummary.netBalance ?? 0
        return (
          <li key={group.id}>
            <Link
              href={`/groups/${group.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm no-underline transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-hidden"
            >
              <span className="min-w-0 truncate">
                {group.displayName || tGroups('invitations.unknownGroup')}
              </span>
              <Money
                currency={getCurrencyFromGroup(group.ledger)}
                amount={Math.abs(netBalance)}
                bold
              />
            </Link>
          </li>
        )
      })}
    </ul>
  )

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="border-b px-4 py-3">{title}</div>
          <div className="max-h-64 overflow-y-auto p-2">{list}</div>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="text-start">
          <DrawerTitle>{label}</DrawerTitle>
          <DrawerDescription>
            <Money currency={currency} amount={amount} bold />
            {' · '}
            {groupCount} {groupLabel(groupCount)}
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 overflow-y-auto px-4 pb-4">{list}</div>
      </DrawerContent>
    </Drawer>
  )
}
