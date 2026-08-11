import { useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  CloudDownload,
  Download,
  FileArchive,
  FileText,
  FolderOpen,
  Loader2,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/ui/responsive-dialog'
import { Switch } from '@/components/ui/switch'
import { getApiBaseUrl } from '@/lib/api-url'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import {
  accountExportGroupSectionFor,
  accountExportSelectionIncludesGroup,
  defaultAccountExportSelection,
  type AccountExportGroupSection,
  type AccountExportSelection,
} from '@spliit/domain'

import { SettingsRow, SettingsSection } from './settings-ui'

type AccountGroup = AppRouterOutput['account']['groups']['groups'][number]
const emptyGroups: AccountGroup[] = []

const sectionOrder: AccountExportGroupSection[] = [
  'GROUPS',
  'FRIENDS',
  'STARRED',
  'ARCHIVED',
  'HIDDEN',
]

function initialSelection(): AccountExportSelection {
  return {
    sections: { ...defaultAccountExportSelection.sections },
    groupOverrides: [],
    includeDocuments: defaultAccountExportSelection.includeDocuments,
    includeAccountPreferences:
      defaultAccountExportSelection.includeAccountPreferences,
    includeGroupPreferences:
      defaultAccountExportSelection.includeGroupPreferences,
  }
}

export function AccountExportModal() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'AccountSettings.export',
  })
  const { t: translate } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState(initialSelection)
  const { data, isPending, isError, refetch } = trpc.account.groups.useQuery(
    { includeArchived: true },
    { enabled: open },
  )
  const groups = data?.groups ?? emptyGroups
  const apiUrl = getApiBaseUrl()

  const grouped = useMemo(() => {
    const buckets = new Map<AccountExportGroupSection, AccountGroup[]>()
    for (const section of sectionOrder) buckets.set(section, [])
    for (const group of groups) {
      const section = accountExportGroupSectionFor({
        groupType: group.groupType,
        archived: group.archived,
        starred: group.preference.starred,
        hidden: group.preference.hidden,
      })
      buckets.get(section)?.push(group)
    }
    for (const bucket of buckets.values()) {
      bucket.sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.id.localeCompare(right.id),
      )
    }
    return buckets
  }, [groups])

  const selectedGroups = groups.filter((group) =>
    accountExportSelectionIncludesGroup(
      {
        id: group.id,
        groupType: group.groupType,
        archived: group.archived,
        starred: group.preference.starred,
        hidden: group.preference.hidden,
      },
      selection,
    ),
  )
  const canExport =
    selectedGroups.length > 0 || selection.includeAccountPreferences

  function updateSection(section: AccountExportGroupSection, checked: boolean) {
    const ids = new Set((grouped.get(section) ?? []).map((group) => group.id))
    setSelection((current) => ({
      ...current,
      sections: { ...current.sections, [section]: checked },
      groupOverrides: current.groupOverrides.filter(
        (override) => !ids.has(override.groupSourceId),
      ),
    }))
  }

  function updateGroup(group: AccountGroup, checked: boolean) {
    const section = accountExportGroupSectionFor({
      groupType: group.groupType,
      archived: group.archived,
      starred: group.preference.starred,
      hidden: group.preference.hidden,
    })
    setSelection((current) => {
      const sectionDefault = current.sections[section]
      const nextOverrides = current.groupOverrides.filter(
        (override) => override.groupSourceId !== group.id,
      )
      if (checked !== sectionDefault) {
        nextOverrides.push({ groupSourceId: group.id, included: checked })
      }
      nextOverrides.sort((left, right) =>
        left.groupSourceId.localeCompare(right.groupSourceId),
      )
      return { ...current, groupOverrides: nextOverrides }
    })
  }

  function updateContent(
    key:
      | 'includeDocuments'
      | 'includeAccountPreferences'
      | 'includeGroupPreferences',
    checked: boolean,
  ) {
    setSelection((current) => ({ ...current, [key]: checked }))
  }

  return (
    <SettingsSection
      id="account-export"
      title={t('sectionTitle')}
      description={t('sectionDescription')}
      icon={CloudDownload}
    >
      <SettingsRow
        label={t('sectionRowLabel')}
        description={t('sectionRowDescription')}
        control={
          <ResponsiveDialog open={open} onOpenChange={setOpen}>
            <ResponsiveDialogTrigger
              render={
                <Button type="button" variant="outline">
                  <FileArchive className="me-2 h-4 w-4" aria-hidden="true" />
                  {t('open')}
                </Button>
              }
            />
            <ResponsiveDialogContent className="max-w-2xl p-0">
              <ResponsiveDialogHeader className="border-b px-4 py-4 text-start sm:px-6">
                <ResponsiveDialogTitle className="flex items-center gap-2">
                  <CloudDownload
                    className="h-5 w-5 text-primary"
                    aria-hidden="true"
                  />
                  {t('title')}
                </ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {t('description')}
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>

              <ResponsiveDialogBody className="space-y-5 px-4 py-4 sm:px-6">
                <section aria-labelledby="account-export-content-heading">
                  <div className="mb-2 flex items-center gap-2">
                    <FileText
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <h3
                      id="account-export-content-heading"
                      className="text-sm font-semibold"
                    >
                      {t('contentTitle')}
                    </h3>
                  </div>
                  <div className="divide-y rounded-lg border">
                    <ExportToggle
                      icon={FileText}
                      label={t('content.documents')}
                      description={t('content.documentsDescription')}
                      checked={selection.includeDocuments}
                      onCheckedChange={(checked) =>
                        updateContent('includeDocuments', checked)
                      }
                    />
                    <ExportToggle
                      icon={CloudDownload}
                      label={t('content.accountPreferences')}
                      description={t('content.accountPreferencesDescription')}
                      checked={selection.includeAccountPreferences}
                      onCheckedChange={(checked) =>
                        updateContent('includeAccountPreferences', checked)
                      }
                    />
                    <ExportToggle
                      icon={Users}
                      label={t('content.groupPreferences')}
                      description={t('content.groupPreferencesDescription')}
                      checked={selection.includeGroupPreferences}
                      onCheckedChange={(checked) =>
                        updateContent('includeGroupPreferences', checked)
                      }
                    />
                  </div>
                </section>

                <section aria-labelledby="account-export-groups-heading">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <FolderOpen
                        className="h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <h3
                        id="account-export-groups-heading"
                        className="text-sm font-semibold"
                      >
                        {t('groupsTitle')}
                      </h3>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t('selectedCount', {
                        selected: selectedGroups.length,
                        total: groups.length,
                      })}
                    </span>
                  </div>

                  {isPending ? (
                    <div className="flex items-center justify-center rounded-lg border py-8 text-sm text-muted-foreground">
                      <Loader2
                        className="me-2 h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                      {t('loadingGroups')}
                    </div>
                  ) : isError ? (
                    <Alert variant="destructive">
                      <AlertDescription className="flex items-center justify-between gap-3">
                        <span>{t('groupsError')}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void refetch()}
                        >
                          {t('retry')}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="space-y-2">
                      {sectionOrder.map((section) => {
                        const sectionGroups = grouped.get(section) ?? []
                        const includedCount = sectionGroups.filter((group) =>
                          accountExportSelectionIncludesGroup(
                            {
                              id: group.id,
                              groupType: group.groupType,
                              archived: group.archived,
                              starred: group.preference.starred,
                              hidden: group.preference.hidden,
                            },
                            selection,
                          ),
                        ).length
                        const overrideCount = selection.groupOverrides.filter(
                          (override) =>
                            sectionGroups.some(
                              (group) => group.id === override.groupSourceId,
                            ),
                        ).length
                        const sectionChecked =
                          sectionGroups.length === 0
                            ? selection.sections[section]
                            : includedCount === sectionGroups.length
                        const sectionIndeterminate =
                          includedCount > 0 &&
                          includedCount < sectionGroups.length
                        return (
                          <div
                            key={section}
                            className="overflow-hidden rounded-lg border"
                          >
                            <label className="flex cursor-pointer items-center gap-3 bg-muted/30 px-3 py-2.5">
                              <Checkbox
                                checked={sectionChecked}
                                indeterminate={sectionIndeterminate}
                                onCheckedChange={(checked) =>
                                  updateSection(section, checked === true)
                                }
                                aria-label={t(`sections.${section}`)}
                              />
                              <span className="flex-1 text-sm font-medium">
                                {t(`sections.${section}`)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {overrideCount > 0
                                  ? t('sectionOverrides', {
                                      count: overrideCount,
                                    })
                                  : sectionGroups.length}
                              </span>
                            </label>
                            {sectionGroups.length > 0 ? (
                              <div className="divide-y">
                                {sectionGroups.map((group) => (
                                  <label
                                    key={group.id}
                                    className="flex cursor-pointer items-center gap-3 px-3 py-2.5 ps-10"
                                  >
                                    <Checkbox
                                      checked={accountExportSelectionIncludesGroup(
                                        {
                                          id: group.id,
                                          groupType: group.groupType,
                                          archived: group.archived,
                                          starred: group.preference.starred,
                                          hidden: group.preference.hidden,
                                        },
                                        selection,
                                      )}
                                      onCheckedChange={(checked) =>
                                        updateGroup(group, checked === true)
                                      }
                                      aria-label={group.displayName}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-sm">
                                      {group.displayName}
                                    </span>
                                    {group.archived ? (
                                      <Archive
                                        className="h-3.5 w-3.5 text-muted-foreground"
                                        aria-label={t('badges.archived')}
                                      />
                                    ) : null}
                                    {group.preference.hidden ? (
                                      <ArchiveRestore
                                        className="h-3.5 w-3.5 text-muted-foreground"
                                        aria-label={t('badges.hidden')}
                                      />
                                    ) : null}
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <p className="px-3 py-2 text-xs text-muted-foreground">
                                {t('emptySection')}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              </ResponsiveDialogBody>

              <ResponsiveDialogFooter className="border-t bg-muted/20 px-4 py-3 sm:px-6">
                <ResponsiveDialogClose
                  render={
                    <Button type="button" variant="ghost">
                      {t('cancel')}
                    </Button>
                  }
                />
                <form
                  action={`${apiUrl}/account/export/bundle`}
                  method="post"
                  target="_blank"
                  onSubmit={() => setOpen(false)}
                >
                  <input
                    type="hidden"
                    name="selection"
                    value={JSON.stringify(selection)}
                  />
                  <Button
                    type="submit"
                    disabled={!canExport || isPending || isError}
                  >
                    <Download className="me-2 h-4 w-4" aria-hidden="true" />
                    {t('download')}
                  </Button>
                </form>
              </ResponsiveDialogFooter>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        }
      />
      <SettingsRow
        label={translate('Groups.Import.Cloud.accountTitle')}
        description={translate(
          'Groups.Import.Source.spliitCloudScopeDescription',
        )}
        control={
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void navigate({
                to: '/groups/import',
                search: { source: 'spliit-cloud' },
              })
            }
          >
            <ArchiveRestore className="me-2 h-4 w-4" aria-hidden="true" />
            {translate('Groups.Import.Source.openCloudImporter')}
          </Button>
        }
      />
    </SettingsSection>
  )
}

function ExportToggle({
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  icon: typeof FileText
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icon
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
