import { EmptyState } from '@/components/empty-state'
import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { Eye, EyeOff, Loader2, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ForceArchiveDialogSection } from './force-archive-dialog-section'
import type { AccountGroup } from './group-buckets'
import { partitionGroups } from './group-buckets'
import { GroupCard } from './group-card'
import { PendingInvitations } from './pending-invitations'

export function RecentGroupList() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tEmpty } = useTranslation(undefined, { keyPrefix: 'EmptyState' })
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.account.groups.useQuery({
    includeArchived: true,
  })
  const [showHidden, setShowHidden] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
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
      await Promise.all([
        utils.account.groups.invalidate(),
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

  const isGroupsLoading = isLoading || !data
  const allGroups = data?.groups ?? []
  const groups = showHidden
    ? allGroups
    : allGroups.filter((g) => !g.preference.hidden)

  const groupsEmptyAction = (
    <Button asChild>
      <Link href="/groups/create">
        <Plus className="w-4 h-4 mr-2" />
        {tEmpty('actions.createGroup')}
      </Link>
    </Button>
  )

  const friendsEmptyAction = (
    <Button asChild>
      <Link href="/friends/create">
        <Users className="w-4 h-4 mr-2" />
        {tEmpty('actions.createFriendLedger')}
      </Link>
    </Button>
  )

  const groupsFilteredAction = (
    <Button
      variant="outline"
      onClick={() => setShowHidden(true)}
      disabled={showHidden}
    >
      <Eye className="w-4 h-4 mr-2" />
      {tEmpty('actions.showHidden')}
    </Button>
  )

  let body: React.ReactNode
  if (isGroupsLoading) {
    body = (
      <p>
        <Loader2 className="w-4 m-4 mr-2 inline animate-spin" />{' '}
        {t('loadingRecent')}
      </p>
    )
  } else if (groups.length === 0) {
    if (allGroups.length === 0) {
      body = (
        <EmptyState
          variant="empty"
          itemLabel={tEmpty('labels.group')}
          itemLabelPlural={tEmpty('labels.groupPlural')}
          action={groupsEmptyAction}
        />
      )
    } else {
      body = (
        <div className="space-y-4">
          <EmptyState
            variant="filtered"
            itemLabel={tEmpty('labels.group')}
            itemLabelPlural={tEmpty('labels.groupPlural')}
            action={groupsFilteredAction}
          />
          <EmptyState
            variant="empty"
            itemLabel={tEmpty('labels.friendLedger')}
            itemLabelPlural={tEmpty('labels.friendLedgerPlural')}
            action={friendsEmptyAction}
          />
        </div>
      )
    }
  } else {
    const {
      groups: sectionGroups,
      friends,
      starred,
      archived,
      hidden,
    } = partitionGroups(groups)

    const renderList = (
      list: AccountGroup[],
      variant: 'groups' | 'archived' | 'hidden' | 'friends' | 'starred',
    ) => (
      <ul
        className={`grid gap-2 sm:grid-cols-2 ${
          variant === 'archived' || variant === 'hidden' ? 'opacity-50' : ''
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
              group.currentMemberRole === 'ADMIN' &&
              group.groupType !== 'FRIEND'
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
            {renderList(starred, 'starred')}
          </>
        )}

        {sectionGroups.length > 0 && (
          <>
            <h2 className="mt-6 mb-2">{t('groups')}</h2>
            {renderList(sectionGroups, 'groups')}
          </>
        )}

        {friends.length > 0 && (
          <>
            <div className="mt-6 mb-2 flex items-center justify-between">
              <h2>{t('friends')}</h2>
              <Button variant="ghost" size="icon" asChild>
                <Link href="/friends/create" aria-label={t('friends')}>
                  <Plus className="w-4 h-4" />
                </Link>
              </Button>
            </div>
            {renderList(friends, 'friends')}
          </>
        )}

        {friends.length === 0 && (
          <div className="mt-6">
            <EmptyState
              variant="empty"
              itemLabel={tEmpty('labels.friendLedger')}
              itemLabelPlural={tEmpty('labels.friendLedgerPlural')}
              action={friendsEmptyAction}
            />
          </div>
        )}

        {archived.length > 0 && showArchived && (
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

        {archived.length > 0 && (
          <div className="mt-4">
            <Button
              variant="link"
              className="-m-4"
              onClick={() => setShowArchived((prev) => !prev)}
            >
              {showArchived ? (
                <>
                  <EyeOff className="w-4 h-4 mr-1" />
                  {t('hide')}
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 mr-1" />
                  {t('showArchived')}
                </>
              )}
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <PendingInvitations />
      {body}
      <ForceArchiveDialogSection
        target={forceArchiveTarget}
        onClose={() => setForceArchiveTarget(null)}
      />
    </>
  )
}
