import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { Cloud, Loader2, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.account.groups.useQuery({
    includeArchived: true,
  })
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
      <p>
        <Loader2 className="w-4 m-4 mr-2 inline animate-spin" />{' '}
        {t('loadingRecent')}
      </p>
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
            <ul className="grid gap-3 sm:grid-cols-2 items-stretch">
              {renderGroupItems(starred, 'starred')}
            </ul>
          </CollapsibleSection>
        )}

        <CollapsibleSection
          storageKey={STORAGE_KEYS.groups}
          defaultOpen
          title={t('groups')}
        >
          <ul className="grid gap-3 sm:grid-cols-2 items-stretch">
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
          <ul className="grid gap-3 sm:grid-cols-2 items-stretch">
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
            <ul
              className={`grid gap-3 sm:grid-cols-2 items-stretch opacity-60`}
            >
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
            <ul
              className={`grid gap-3 sm:grid-cols-2 items-stretch opacity-60`}
            >
              {renderGroupItems(hidden, 'hidden')}
            </ul>
          </CollapsibleSection>
        )}
      </div>
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
