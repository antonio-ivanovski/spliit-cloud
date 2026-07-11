import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Archive as ArchiveIcon, ArchiveRestore } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup } from './current-group-context'

type Props = {
  groupId: string
}

export function GroupTabs({ groupId }: Props) {
  const { t } = useTranslation()
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const pathname = useLocation({ select: (location) => location.pathname })
  const value =
    pathname.replace(/\/groups\/[^/]+\/([^/]+).*/, '$1') || 'expenses'
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const { toast } = useToast()
  const { mutateAsync: archiveGroup } = trpc.groups.archive.useMutation()
  const { data } = trpc.account.members.useQuery({ groupId })
  const { group, currentMember } = useCurrentGroup()
  const memberCount = data?.members?.length ?? 0
  // The "Settings" tab is also the member-accessible home for export.
  // Members see a read-only settings view; admins additionally see the
  // group editing and lifecycle controls.
  const canViewSettings = !!currentMember
  const canUnarchive = !!group?.archived && currentMember?.role === 'ADMIN'
  const isArchived = !!group?.archived
  // FRIEND-typed ledgers are strictly 2 people, so the Members tab is
  // redundant (the peer is shown on the card already) and is hidden.
  const isFriendLedger = group?.groupType === 'FRIEND'

  async function handleUnarchive() {
    try {
      await archiveGroup({ groupId, archived: false })
      await Promise.all([
        utils.account.groups.invalidate(),
        utils.groups.get.invalidate({ groupId }),
      ])
      toast({ description: tGroups('bannerUnarchiveSuccess') })
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : tGroups('unarchiveSuccess'),
        variant: 'destructive',
      })
    }
  }

  return (
    <>
      {isArchived && (
        <Alert>
          <ArchiveIcon className="w-4 h-4" />
          <AlertTitle>{tGroups('bannerArchivedTitle')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-2">
            <span>{tGroups('bannerArchivedDescription')}</span>
            {canUnarchive && (
              <Button size="sm" variant="secondary" onClick={handleUnarchive}>
                <ArchiveRestore className="w-4 h-4 mr-2" />
                {tGroups('bannerUnarchive')}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <Tabs
        value={value}
        className="*:border overflow-x-auto"
        onValueChange={(value) => {
          navigate({ href: `/groups/${groupId}/${value}` })
        }}
      >
        <TabsList>
          <TabsTrigger value="expenses">{t('Expenses.title')}</TabsTrigger>
          <TabsTrigger value="balances">{t('Balances.title')}</TabsTrigger>
          <TabsTrigger value="information">
            {t('Information.title')}
          </TabsTrigger>
          <TabsTrigger value="stats">{t('Stats.title')}</TabsTrigger>
          <TabsTrigger value="activity">{t('Activity.title')}</TabsTrigger>
          {!isFriendLedger && (
            <TabsTrigger value="members" className="flex items-center gap-2">
              <span>{t('Members.title')}</span>
              {memberCount > 0 && (
                <Badge
                  variant="outline"
                  className="px-1.5 py-0 text-current border-current"
                >
                  {memberCount}
                </Badge>
              )}
            </TabsTrigger>
          )}
          {canViewSettings && (
            <TabsTrigger value="edit">{t('Settings.title')}</TabsTrigger>
          )}
        </TabsList>
      </Tabs>
    </>
  )
}
