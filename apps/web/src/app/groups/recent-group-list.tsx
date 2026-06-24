'use client'

import { ForceArchiveDialog } from '@/components/force-archive-dialog'
import Link from '@/components/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useLocale, useTranslations } from '@/i18n/react'
import { useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { StarFilledIcon } from '@radix-ui/react-icons'
import type { AppRouterOutput } from '@spliit/api/router'
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Star,
  Users,
  X,
} from 'lucide-react'
import { PropsWithChildren, useState } from 'react'

type AccountGroup = AppRouterOutput['account']['groups']['groups'][number]

type GroupBucket = 'active' | 'archived' | 'hidden'

function bucketFor(group: AccountGroup): GroupBucket {
  // The user's per-account "hide" preference wins over the group-level
  // archive flag when sorting into sections: a hidden group only appears
  // in the (initially collapsed) "Hidden" section, while a group-archived
  // group appears in the "Archived" section even if the user has not
  // hidden it.
  if (group.preference.hidden) return 'hidden'
  if (group.archived) return 'archived'
  return 'active'
}

function partitionGroups(groups: AccountGroup[]) {
  const active: AccountGroup[] = []
  const starred: AccountGroup[] = []
  const archived: AccountGroup[] = []
  const hidden: AccountGroup[] = []
  for (const group of groups) {
    const bucket = bucketFor(group)
    if (bucket === 'archived') archived.push(group)
    else if (bucket === 'hidden') hidden.push(group)
    else if (group.preference.starred) starred.push(group)
    else active.push(group)
  }
  return { active, starred, archived, hidden }
}

function formatDate(value: string | Date, locale: string) {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function RecentGroupList() {
  const t = useTranslations('Groups')
  const utils = trpc.useUtils()
  // `includeArchived: true` keeps the "Archived" section populated; the
  // "Show hidden groups" toggle below controls whether the user-hidden
  // bucket is rendered at all (the API returns both, the FE filters the
  // view).
  const { data, isLoading } = trpc.account.groups.useQuery({
    includeArchived: true,
  })
  const [showHidden, setShowHidden] = useState(false)
  // `forceArchiveTarget` is the group awaiting confirmation in the
  // "Unsettled balances" dialog. Setting it opens the dialog; clearing it
  // dismisses the dialog without performing any mutation.
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
    await utils.account.groups.invalidate()
  }

  async function archiveGroupWithBalancesCheck(
    group: AccountGroup,
    nextArchived: boolean,
  ) {
    try {
      await archiveGroup({ groupId: group.id, archived: nextArchived })
      // Invalidate both the account-backed group list (for this dropdown)
      // and the per-group `groups.get` query (for the layout that loads
      // when the user navigates into the group). Without invalidating
      // `groups.get`, the layout's archived banner and disabled "+"
      // button would render from stale data.
      await Promise.all([
        utils.account.groups.invalidate(),
        utils.groups.get.invalidate({ groupId: group.id }),
      ])
      toast({
        description: nextArchived ? t('archiveSuccess') : t('unarchiveSuccess'),
      })
    } catch (error) {
      // `PRECONDITION_FAILED` is the typed "has unsettled balances" signal
      // from the archive procedure. Surface the confirmation dialog so the
      // user can choose to force-archive (which auto-creates settlement
      // expenses) or cancel and review balances first.
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

  const isGroupsLoading = isLoading || !data
  const allGroups = data?.groups ?? []
  // Even with `includeArchived: true`, user-hidden groups are returned by
  // the API; we keep them out of the rendered list until the user toggles
  // "Show hidden groups" on.
  const groups = showHidden
    ? allGroups
    : allGroups.filter((g) => !g.preference.hidden)

  let body: React.ReactNode = null
  if (isGroupsLoading) {
    body = (
      <p>
        <Loader2 className="w-4 m-4 mr-2 inline animate-spin" />{' '}
        {t('loadingRecent')}
      </p>
    )
  } else if (groups.length === 0) {
    const hasHiddenGroups = allGroups.some((g) => g.preference.hidden)
    body = (
      <div className="text-sm space-y-2">
        {hasHiddenGroups ? (
          <>
            <p>{t('NoRecentAllHidden.description')}</p>
            <Button
              variant="link"
              className="-m-4"
              onClick={() => setShowHidden(true)}
            >
              {t('NoRecentAllHidden.showHidden')}
            </Button>
          </>
        ) : (
          <>
            <p>{t('NoRecent.description')}</p>
            <p>
              <Button variant="link" asChild className="-m-4">
                <Link href={`/groups/create`}>{t('NoRecent.create')}</Link>
              </Button>{' '}
              {t('NoRecent.orAsk')}
            </p>
          </>
        )}
      </div>
    )
  } else {
    const { starred, active, archived, hidden } = partitionGroups(groups)

    const renderList = (
      list: AccountGroup[],
      variant: 'active' | 'archived' | 'hidden',
    ) => (
      <ul
        className={`grid gap-2 sm:grid-cols-2 ${
          variant !== 'active' ? 'opacity-50' : ''
        }`}
      >
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
              group.currentMemberRole === 'OWNER' ||
              group.currentMemberRole === 'ADMIN'
                ? () => toggleArchived(group)
                : undefined
            }
          />
        ))}
      </ul>
    )

    body = (
      <>
        {starred.length > 0 && (
          <>
            <h2 className="mb-2">{t('starred')}</h2>
            {renderList(starred, 'active')}
          </>
        )}

        {active.length > 0 && (
          <>
            {starred.length > 0 && <h2 className="mt-6 mb-2">{t('recent')}</h2>}
            {starred.length === 0 && <h2 className="mb-2">{t('recent')}</h2>}
            {renderList(active, 'active')}
          </>
        )}

        {archived.length > 0 && (
          <>
            <h2 className="mt-6 mb-2">{t('archived')}</h2>
            {renderList(archived, 'archived')}
          </>
        )}

        {hidden.length > 0 && showHidden && (
          <>
            <h2 className="mt-6 mb-2">{t('hidden')}</h2>
            {renderList(hidden, 'hidden')}
          </>
        )}

        {allGroups.some((g) => g.preference.hidden) && (
          <div className="mt-4">
            <Button
              variant="link"
              className="-m-4"
              onClick={() => setShowHidden((prev) => !prev)}
            >
              {showHidden ? (
                <>
                  <EyeOff className="w-4 h-4 mr-1" />
                  {t('hide')}
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 mr-1" />
                  {t('showHidden')}
                </>
              )}
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <GroupsPage>
      <PendingInvitations />
      {body}
      <ForceArchiveDialogSection
        target={forceArchiveTarget}
        onClose={() => setForceArchiveTarget(null)}
      />
    </GroupsPage>
  )
}

function ForceArchiveDialogSection({
  target,
  onClose,
}: {
  target: AccountGroup | null
  onClose: () => void
}) {
  return <ForceArchiveDialog groupId={target?.id ?? null} onClose={onClose} />
}

function PendingInvitations() {
  const t = useTranslations('Groups')
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const invitationsQuery = trpc.invitations.listForAccount.useQuery()

  const acceptMutation = trpc.invitations.accept.useMutation({
    onSuccess: async (data) => {
      toast({ description: t('invitations.accepted') })
      await Promise.all([
        utils.account.groups.invalidate(),
        utils.invitations.listForAccount.invalidate(),
      ])
      router.push(`/groups/${data.groupId}`)
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const declineMutation = trpc.invitations.decline.useMutation({
    onSuccess: async () => {
      toast({ description: t('invitations.declined') })
      await utils.invitations.listForAccount.invalidate()
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
    },
  })

  const invitations = invitationsQuery.data?.invitations ?? []

  if (invitationsQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('invitations.title')}</CardTitle>
          <CardDescription>{t('invitations.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 py-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (invitations.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('invitations.title')}
          <Badge variant="secondary">{invitations.length}</Badge>
        </CardTitle>
        <CardDescription>{t('invitations.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y rounded-lg border">
          {invitations.map((invitation) => {
            const inviterName =
              invitation.invitedBy?.name ||
              invitation.invitedBy?.email ||
              t('invitations.unknownInviter')
            const groupId = invitation.group?.id
            // The row is clickable to preview the group before accepting.
            // We use a stretched-link pattern: the group name is a real
            // <Link>, and its ::before pseudo-element covers the row so
            // clicking anywhere (except the action buttons) navigates.
            return (
              <li
                key={invitation.id}
                className="relative flex flex-col gap-2 p-3 first:rounded-t-lg last:rounded-b-lg sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  {groupId ? (
                    <Link
                      href={`/groups/${groupId}`}
                      className="font-medium text-foreground no-underline outline-none focus-visible:underline before:absolute before:inset-0 before:rounded-md before:content-['']"
                      title={
                        invitation.group?.name ?? t('invitations.unknownGroup')
                      }
                    >
                      {invitation.group?.name ?? t('invitations.unknownGroup')}
                    </Link>
                  ) : (
                    <p className="font-medium text-foreground truncate">
                      {invitation.group?.name ?? t('invitations.unknownGroup')}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('invitations.invitedBy', { name: inviterName })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('invitations.sentOn', {
                      date: formatDate(invitation.createdAt, locale),
                    })}
                  </p>
                </div>
                <div className="flex gap-2 sm:shrink-0 relative z-10">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={declineMutation.isPending}
                    onClick={() =>
                      declineMutation.mutate({ invitationId: invitation.id })
                    }
                  >
                    <X className="w-4 h-4 mr-1" />
                    {t('invitations.decline')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={acceptMutation.isPending}
                    onClick={() =>
                      acceptMutation.mutate({ invitationId: invitation.id })
                    }
                  >
                    <Check className="w-4 h-4 mr-1" />
                    {t('invitations.accept')}
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function GroupCard({
  group,
  variant,
  onToggleStar,
  onToggleHidden,
  onToggleArchived,
}: {
  group: AccountGroup
  variant: 'active' | 'archived' | 'hidden'
  onToggleStar: () => void
  onToggleHidden: () => void
  // Only provided for OWNER/ADMIN. MEMBERs cannot archive the group.
  onToggleArchived?: () => void
}) {
  const t = useTranslations('Groups')
  const locale = useLocale()
  const isStarred = group.preference.starred
  const isHidden = group.preference.hidden
  const isArchived = group.archived

  return (
    <li key={group.id}>
      {/* Stretched-link card. The visible card is a non-interactive
          container; the group name is a real <Link> whose ::before
          pseudo-element covers the entire card so clicking anywhere on
          it (except the absolutely-positioned action buttons) navigates
          to the group. */}
      <div className="relative h-fit w-full py-3 pl-3 pr-1 rounded-lg border bg-card shadow-sm text-base">
        <div className="w-full flex flex-col gap-1">
          <div className="text-base flex gap-2 justify-between items-center">
            <span className="flex-1 overflow-hidden text-ellipsis font-medium min-w-0">
              <Link
                href={`/groups/${group.id}`}
                className="text-foreground no-underline outline-none focus-visible:underline before:absolute before:inset-0 before:rounded-lg before:content-['']"
                title={group.name}
              >
                {group.name}
              </Link>
            </span>
            <span className="flex-shrink-0 relative z-10 flex items-center">
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
                  <StarFilledIcon className="w-4 h-4 text-orange-400" />
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
                  {/* Per-account "hide" — available to everyone. */}
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
                  {/* Group-level "archive" — OWNER/ADMIN only. */}
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

function GroupsPage({ children }: PropsWithChildren<{}>) {
  const t = useTranslations('Groups')
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h1 className="font-bold text-2xl flex-1">
          <Link href="/groups">{t('myGroups')}</Link>
        </h1>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/groups/create">{t('create')}</Link>
          </Button>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </>
  )
}
