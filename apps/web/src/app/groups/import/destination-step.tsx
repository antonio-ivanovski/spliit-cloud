'use client'

import { GroupForm } from '@/components/group-form'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trpc } from '@/trpc/client'
import {
  appendImportedFromNote,
  type NormalizedSource,
} from '@spliit/domain/import'
import { FolderPlus, Layers } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

type Props = {
  source: NormalizedSource
  initialGroupFormValues: {
    name: string
    information: string
    currency: string
    currencyCode: string
  }
  onContinue: (choice: {
    mode: 'NEW_GROUP' | 'EXISTING_GROUP'
    targetGroupId: string | null
    groupFormValues: {
      name: string
      information: string
      currency: string
      currencyCode: string
    }
  }) => void
}

export function DestinationStep({
  source,
  initialGroupFormValues,
  onContinue,
}: Props) {
  const [mode, setMode] = useState<'NEW_GROUP' | 'EXISTING_GROUP'>('NEW_GROUP')
  const { t } = useTranslation()
  const { data, isLoading } = trpc.account.groups.useQuery({
    includeArchived: false,
  })
  const groups = (data?.groups ?? []).filter(
    (g) => g.currentMemberRole === 'ADMIN',
  )

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
        value={mode}
        onValueChange={(v) => setMode(v as 'NEW_GROUP' | 'EXISTING_GROUP')}
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="NEW_GROUP" className="gap-2">
            <FolderPlus className="h-4 w-4" />
            {t('Groups.Import.Destination.newGroup')}
          </TabsTrigger>
          <TabsTrigger value="EXISTING_GROUP" className="gap-2">
            <Layers className="h-4 w-4" />
            {t('Groups.Import.Destination.existingGroup')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="NEW_GROUP">
          <Card>
            <CardContent className="p-4">
              <GroupForm
                initialValues={{
                  name: source.name,
                  information:
                    initialGroupFormValues.information ||
                    appendImportedFromNote(undefined, source.sourceUrl) ||
                    '',
                  currency: source.currency,
                  currencyCode: source.currencyCode || undefined,
                }}
                onSubmit={async (values) => {
                  onContinue({
                    mode: 'NEW_GROUP',
                    targetGroupId: null,
                    groupFormValues: {
                      name: values.name,
                      information: values.information ?? '',
                      currency: values.currency,
                      currencyCode: values.currencyCode ?? '',
                    },
                  })
                }}
                hideInviteHint
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="EXISTING_GROUP">
          {isLoading ? (
            <p>{t('Groups.Import.Destination.loading')}</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('Groups.Import.Destination.noAdminGroups')}
            </p>
          ) : (
            <div className="grid gap-2">
              {groups.map((g) => (
                <Card
                  key={g.id}
                  className="cursor-pointer hover:border-primary transition"
                  onClick={() =>
                    onContinue({
                      mode: 'EXISTING_GROUP',
                      targetGroupId: g.id,
                      groupFormValues: initialGroupFormValues,
                    })
                  }
                >
                  <CardContent className="py-3 px-4">
                    <p className="font-medium">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('Groups.Import.Destination.memberCount', {
                        count: g._count.members,
                      })}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
