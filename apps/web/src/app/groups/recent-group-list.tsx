import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ForceArchiveDialogSection } from './force-archive-dialog-section'
import type { AccountGroup } from './group-buckets'
import { partitionGroups } from './group-buckets'
import { GroupCard } from './group-card'
import { PendingInvitations } from './pending-invitations'

export function RecentGroupList() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.account.groups.useQuery({
    includeArchived: true,
  })
  const [showHidden, setShowHidden] = useState(false)
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

  let body: React.ReactNode
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
