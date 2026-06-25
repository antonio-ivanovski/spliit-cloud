'use client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { usePathname, useRouter } from '@/lib/navigation'
import { trpc } from '@/trpc/client'
import { Archive as ArchiveIcon, ArchiveRestore } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup } from './current-group-context'

type Props = {
  groupId: string
}

export function GroupTabs({ groupId }: Props) {
  const { t } = useTranslation()
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const pathname = usePathname()
  const value =
    pathname.replace(/\/groups\/[^\/]+\/([^/]+).*/, '$1') || 'expenses'
  const router = useRouter()
  const utils = trpc.useUtils()
  const { toast } = useToast()
  const { mutateAsync: archiveGroup } = trpc.groups.archive.useMutation()
  const { data } = trpc.account.members.useQuery({ groupId })
  const { group, currentMember } = useCurrentGroup()
  const memberCount = data?.members?.length ?? 0
  // The "Settings" tab is the /edit route, which is only meaningful for
  // OWNER/ADMIN. MEMBERs are redirected to a read-only view, so we hide
  // the tab entirely.
  const canEditSettings =
    currentMember?.role === 'OWNER' || currentMember?.role === 'ADMIN'
  const canUnarchive =
    !!group?.archived &&
    (currentMember?.role === 'OWNER' || currentMember?.role === 'ADMIN')
  const isArchived = !!group?.archived

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
        className="[&>*]:border overflow-x-auto"
        onValueChange={(value) => {
          router.push({ href: `/groups/${groupId}/${value}` })
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
          {canEditSettings && (
            <TabsTrigger value="edit">{t('Settings.title')}</TabsTrigger>
          )}
        </TabsList>
      </Tabs>
    </>
  )
}
