import { Archive, FolderPlus, Layers } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { GroupForm } from '@/components/group-form'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trpc } from '@/trpc/client'
import {
  appendImportedFromNote,
  type NormalizedSource,
} from '@spliit/domain/import'

import { GroupCard } from '../group-card'
import type { ImportGroupFormValues } from './import-wizard-state'
import { WizardNav } from './wizard-nav'

const DESTINATION_FORM_ID = 'import-wizard-destination-form'

type Props = {
  source: NormalizedSource
  initialGroupFormValues: ImportGroupFormValues
  mode: 'NEW_GROUP' | 'EXISTING_GROUP' | null
  allowExisting?: boolean
  currencyLocked?: boolean
  hideNameField?: boolean
  /**
   * When `true`, the appearance picker is hidden (friend-ledger restores carry
   * no appearance). Mirrors `GroupForm`'s `hideAppearance`.
   */
  hideAppearance?: boolean
  initialArchived?: boolean
  onArchivedChange?: (archived: boolean) => void
  onBack: () => void
  onContinue: (choice: {
    mode: 'NEW_GROUP' | 'EXISTING_GROUP'
    targetGroupId: string | null
    groupFormValues: ImportGroupFormValues
  }) => void
}

export function DestinationStep({
  source,
  initialGroupFormValues,
  mode,
  allowExisting = true,
  currencyLocked = false,
  hideNameField = false,
  hideAppearance = false,
  initialArchived = false,
  onArchivedChange,
  onBack,
  onContinue,
}: Props) {
  const [currentMode, setCurrentMode] = useState<
    'NEW_GROUP' | 'EXISTING_GROUP'
  >(allowExisting ? (mode ?? 'NEW_GROUP') : 'NEW_GROUP')
  const { t } = useTranslation()
  const { data, isLoading } = trpc.account.groups.useQuery({
    includeArchived: false,
  })
  const groups = (data?.groups ?? []).filter(
    (g) => g.currentMemberRole === 'ADMIN' && g.groupType !== 'FRIEND',
  )

  // EXISTING_GROUP mode transitions via clicking a group card, so the
  // wizard's Continue button is meaningless there. NEW_GROUP mode
  // submits via the form below.
  const continueAsFormId =
    currentMode === 'NEW_GROUP' ? DESTINATION_FORM_ID : undefined

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        <Trans
          i18nKey="Groups.Import.Destination.heading"
          values={{
            name: source.name,
            participantCount: source.participants.length,
            expenseCount: source.expenses.length,
          }}
          components={{ strong: <strong /> }}
        />
      </p>

      <Tabs
        value={currentMode}
        onValueChange={(v) =>
          setCurrentMode(v as 'NEW_GROUP' | 'EXISTING_GROUP')
        }
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="NEW_GROUP" className="gap-2">
            <FolderPlus className="h-4 w-4" />
            {t('Groups.Import.Destination.newGroup')}
          </TabsTrigger>
          {allowExisting && (
            <TabsTrigger value="EXISTING_GROUP" className="gap-2">
              <Layers className="h-4 w-4" />
              {t('Groups.Import.Destination.existingGroup')}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="NEW_GROUP">
          <Card>
            <CardContent spacing="standalone">
              <GroupForm
                formId={DESTINATION_FORM_ID}
                hideActions
                // Friend-ledger restores carry no appearance; every other
                // import offers the same inline picker as group creation.
                hideAppearance={hideAppearance}
                initialValues={{
                  name: initialGroupFormValues.name || source.name,
                  information:
                    initialGroupFormValues.information ||
                    appendImportedFromNote(undefined, source.sourceUrl) ||
                    '',
                  currency: initialGroupFormValues.currency || source.currency,
                  // An explicit empty string means "custom currency" and
                  // prevents GroupForm from applying the account default.
                  currencyCode: initialGroupFormValues.currencyCode,
                  // Appearance prefill (e.g. restored from a cloud export);
                  // otherwise blank unless the user picks.
                  emoji: initialGroupFormValues.emoji,
                  color: initialGroupFormValues.color,
                }}
                currencyLocked={currencyLocked}
                hideNameField={hideNameField}
                onSubmit={async (values) => {
                  onContinue({
                    mode: 'NEW_GROUP',
                    targetGroupId: null,
                    groupFormValues: {
                      name: values.name,
                      information: values.information ?? '',
                      currency: values.currency,
                      currencyCode: values.currencyCode ?? '',
                      // Threaded untouched so the import APIs resolve the
                      // same blank/pick/none tri-state as group creation.
                      emoji: values.emoji,
                      color: values.color,
                    },
                  })
                }}
                hideInviteHint
              />
            </CardContent>
          </Card>
          {onArchivedChange && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <Checkbox
                checked={initialArchived}
                onCheckedChange={(checked) =>
                  onArchivedChange(checked === true)
                }
              />
              <span className="flex items-center gap-2">
                <Archive className="h-4 w-4" />
                {t('Groups.Import.Cloud.restoreArchived')}
              </span>
            </label>
          )}
        </TabsContent>

        {allowExisting && (
          <TabsContent value="EXISTING_GROUP">
            {isLoading ? (
              <p>{t('Groups.Import.Destination.loading')}</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('Groups.Import.Destination.noAdminGroups')}
              </p>
            ) : (
              <ul className="grid list-none gap-2 p-0">
                {groups.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    hideFinancialSummary
                    onSelect={(groupId) =>
                      onContinue({
                        mode: 'EXISTING_GROUP',
                        targetGroupId: groupId,
                        groupFormValues: initialGroupFormValues,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </TabsContent>
        )}
      </Tabs>

      <WizardNav
        step="destination"
        onBack={onBack}
        continueAsFormId={continueAsFormId}
      />
    </div>
  )
}
