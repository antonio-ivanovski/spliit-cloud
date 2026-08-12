import {
  AlertCircle,
  Archive,
  CheckCircle2,
  EyeOff,
  FileText,
  ReceiptText,
  Star,
  UserRound,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  accountExportGroupSectionFor,
  type AccountExportGroupSection,
} from '@spliit/domain'

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

const importSectionOrder: AccountExportGroupSection[] = [
  'STARRED',
  'GROUPS',
  'FRIENDS',
  'ARCHIVED',
  'HIDDEN',
]

const sectionIcons = {
  STARRED: Star,
  GROUPS: Users,
  FRIENDS: UserRound,
  ARCHIVED: Archive,
  HIDDEN: EyeOff,
} satisfies Record<AccountExportGroupSection, typeof Users>

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
                <AccountImportLedgerSections
                  bundle={bundle}
                  selectedGroupIds={selectedGroupIds}
                  disabledGroupIds={disabledGroupIds}
                  onToggleGroup={onToggleGroup}
                />
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

function AccountImportLedgerSections({
  bundle,
  selectedGroupIds,
  disabledGroupIds,
  onToggleGroup,
}: Pick<
  Props,
  'bundle' | 'selectedGroupIds' | 'disabledGroupIds' | 'onToggleGroup'
>) {
  const { t } = useTranslation()
  const groupPreferences = new Map(
    (bundle.manifest.groupPreferences ?? []).map((preference) => [
      preference.groupSourceId,
      preference,
    ]),
  )
  const groupedLedgers = new Map(
    importSectionOrder.map((section) => [section, []] as const),
  ) as Map<AccountExportGroupSection, typeof bundle.groups>
  for (const group of bundle.groups) {
    const preference = groupPreferences.get(group.index.sourceId)
    const section = accountExportGroupSectionFor({
      groupType: group.index.groupType,
      archived: group.index.archived,
      starred: preference?.starred ?? false,
      hidden: preference?.hidden ?? false,
    })
    groupedLedgers.get(section)?.push(group)
  }

  return (
    <div className="space-y-3">
      {importSectionOrder.map((section) => {
        const sectionGroups = groupedLedgers.get(section) ?? []
        if (sectionGroups.length === 0) return null
        const SectionIcon = sectionIcons[section]
        return (
          <fieldset key={section} className="overflow-hidden rounded-lg border">
            <legend className="sr-only">
              {t(`AccountSettings.export.sections.${section}`)}
            </legend>
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2.5">
              <SectionIcon
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <h4 className="flex-1 text-sm font-medium">
                {t(`AccountSettings.export.sections.${section}`)}
              </h4>
              <span className="text-xs text-muted-foreground tabular-nums">
                {sectionGroups.length}
              </span>
            </div>
            <div className="divide-y">
              {sectionGroups.map(({ index, inspection }) => {
                const documentCount =
                  inspection.manifest.expenses.reduce(
                    (count, expense) => count + expense.documents.length,
                    0,
                  ) + inspection.manifest.orphanDocuments.length
                return (
                  <label
                    key={index.sourceId}
                    className="flex cursor-pointer items-start gap-3 px-3 py-3"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedGroupIds.has(index.sourceId)}
                      disabled={disabledGroupIds?.has(index.sourceId)}
                      onCheckedChange={(checked) =>
                        onToggleGroup(index.sourceId, checked === true)
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {index.displayName}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {inspection.manifest.group.ledger.currencyCode ??
                            inspection.manifest.group.ledger.currency}
                        </span>
                        <LedgerFact
                          icon={Users}
                          value={inspection.manifest.participants.length}
                          label={t('Groups.Import.Cloud.confirmParticipants', {
                            count: inspection.manifest.participants.length,
                          })}
                        />
                        <LedgerFact
                          icon={ReceiptText}
                          value={inspection.manifest.expenses.length}
                          label={t('Groups.Import.Cloud.confirmExpenses', {
                            count: inspection.manifest.expenses.length,
                          })}
                        />
                        <LedgerFact
                          icon={FileText}
                          value={documentCount}
                          label={t('Groups.Import.Cloud.confirmDocuments', {
                            count: documentCount,
                          })}
                        />
                      </span>
                    </span>
                    {inspection.documentIssues.length > 0 ? (
                      <AlertCircle
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-label={t(
                          'Groups.Import.Cloud.incompleteDescription',
                          { count: inspection.documentIssues.length },
                        )}
                      />
                    ) : null}
                  </label>
                )
              })}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}

function LedgerFact({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Users
  value: number
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={label}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="tabular-nums">{value}</span>
    </span>
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
