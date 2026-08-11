import { AlertCircle, CheckCircle2, FileText, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'

import type { CloudAccountBundleInspection } from './cloud-bundle'

type Props = {
  bundle: CloudAccountBundleInspection
  selectedGroupIds: ReadonlySet<string>
  disabledGroupIds?: ReadonlySet<string>
  includeAccountPreferences: boolean
  allowAccountPreferencesToggle?: boolean
  includeGroupPreferences: boolean
  isApplying: boolean
  error: string | null
  onToggleGroup: (groupId: string, checked: boolean) => void
  onToggleAccountPreferences: (checked: boolean) => void
  onToggleGroupPreferences: (checked: boolean) => void
  onContinue: () => void
  onChooseAnother?: () => void
  finished?: boolean
  completedGroupIds?: ReadonlyArray<string>
  skippedGroupIds?: ReadonlyArray<string>
}

export function AccountImportSetup({
  bundle,
  selectedGroupIds,
  disabledGroupIds = new Set(),
  includeAccountPreferences,
  allowAccountPreferencesToggle = true,
  includeGroupPreferences,
  isApplying,
  error,
  onToggleGroup,
  onToggleAccountPreferences,
  onToggleGroupPreferences,
  onContinue,
  onChooseAnother,
  finished = false,
  completedGroupIds = [],
  skippedGroupIds = [],
}: Props) {
  const { t } = useTranslation()
  const hasAccountPreferences =
    bundle.manifest.contents.accountPreferences &&
    (bundle.manifest.account.preferences !== null ||
      bundle.manifest.account.notificationPreferences !== null)
  const hasGroupPreferences =
    bundle.manifest.contents.groupPreferences &&
    bundle.manifest.groupPreferences !== null
  const showPreferences =
    (hasAccountPreferences && allowAccountPreferencesToggle) ||
    hasGroupPreferences
  const incompleteGroupCount = bundle.groups.filter(
    ({ inspection }) =>
      !inspection.manifest.complete || inspection.documentIssues.length > 0,
  ).length
  // Account exports aggregate each missing document warning at the root and
  // nested group levels. Prefer the authoritative root count to avoid
  // displaying the same issue multiple times, while still handling older
  // bundles that only carry nested warnings.
  const nestedWarningCount = bundle.groups.reduce(
    (count, { inspection }) =>
      count +
      inspection.manifest.warnings.length +
      inspection.documentIssues.length,
    0,
  )
  const warningCount = bundle.manifest.warnings.length || nestedWarningCount
  const incompleteCount = Math.max(
    bundle.manifest.complete ? 0 : 1,
    warningCount,
    incompleteGroupCount,
  )

  return (
    <div className="flex flex-col gap-4">
      {finished ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6 text-center">
            <h2 className="text-lg font-semibold">
              {t('Groups.Import.Done.importComplete')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('AccountSettings.export.selectedCount', {
                selected: completedGroupIds.length,
                total: bundle.groups.length,
              })}
            </p>
            {skippedGroupIds.length > 0 ? (
              <div className="text-sm text-muted-foreground">
                <p>
                  {skippedGroupIds.length}{' '}
                  {t('Groups.Import.Documents.skipTitle')}
                </p>
                <ul className="mt-1 list-disc ps-5 text-start">
                  {skippedGroupIds.map((sourceId) => (
                    <li key={sourceId}>
                      {bundle.groups.find(
                        ({ index }) => index.sourceId === sourceId,
                      )?.index.displayName ?? sourceId}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Button type="button" className="self-center" onClick={onContinue}>
              {t('Groups.backToHome')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {finished ? null : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {t('Groups.Import.Cloud.accountTitle')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('Groups.Import.Source.cloudBundleReadyDescription')}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                <p className="font-medium">{bundle.manifest.account.name}</p>
                {bundle.manifest.account.email ? (
                  <p className="text-muted-foreground">
                    {bundle.manifest.account.email}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('AccountSettings.export.selectedCount', {
                    selected: selectedGroupIds.size,
                    total: bundle.groups.length,
                  })}
                </p>
              </div>
              {!bundle.manifest.complete || incompleteCount > 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle>
                    {t('Groups.Import.Cloud.incompleteTitle')}
                  </AlertTitle>
                  <AlertDescription>
                    {t('Groups.Import.Cloud.incompleteDescription', {
                      count: incompleteCount,
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}
              {showPreferences && (
                <div className="flex flex-col gap-3 border-t pt-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <FileText
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {t('AccountSettings.export.contentTitle')}
                  </h3>
                  <div className="divide-y rounded-lg border">
                    {hasAccountPreferences && allowAccountPreferencesToggle ? (
                      <PreferenceToggle
                        label={t(
                          'AccountSettings.export.content.accountPreferences',
                        )}
                        description={t(
                          'AccountSettings.export.content.accountPreferencesDescription',
                        )}
                        checked={includeAccountPreferences}
                        onCheckedChange={onToggleAccountPreferences}
                      />
                    ) : null}
                    {hasGroupPreferences ? (
                      <PreferenceToggle
                        label={t(
                          'AccountSettings.export.content.groupPreferences',
                        )}
                        description={t(
                          'AccountSettings.export.content.groupPreferencesDescription',
                        )}
                        checked={includeGroupPreferences}
                        onCheckedChange={onToggleGroupPreferences}
                      />
                    ) : null}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3 border-t pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Users
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {t('AccountSettings.export.groupsTitle')}
                </h3>
                <div className="divide-y rounded-lg border">
                  {bundle.groups.map(({ index, inspection }) => (
                    <label
                      key={index.sourceId}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
                    >
                      <Checkbox
                        checked={selectedGroupIds.has(index.sourceId)}
                        disabled={disabledGroupIds.has(index.sourceId)}
                        onCheckedChange={(checked) =>
                          onToggleGroup(index.sourceId, checked === true)
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {index.displayName}
                      </span>
                      {index.archived ? (
                        <span className="text-xs text-muted-foreground">
                          {t('AccountSettings.export.badges.archived')}
                        </span>
                      ) : null}
                      {inspection.documentIssues.length > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {inspection.documentIssues.length}
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
                {bundle.groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('AccountSettings.export.emptySection')}
                  </p>
                ) : null}
                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                <Button
                  type="button"
                  className="self-end"
                  disabled={
                    isApplying ||
                    (selectedGroupIds.size === 0 &&
                      !(hasAccountPreferences && includeAccountPreferences))
                  }
                  onClick={onContinue}
                >
                  {isApplying
                    ? t('Groups.Import.Confirm.importingButton')
                    : t('Groups.Import.Cloud.continueToGroups')}
                </Button>
                {onChooseAnother ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-end"
                    disabled={isApplying}
                    onClick={onChooseAnother}
                  >
                    {t('Groups.Import.Cloud.importAnother')}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function PreferenceToggle({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <CheckCircle2
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  )
}
