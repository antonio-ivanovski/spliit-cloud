import { Link } from '@tanstack/react-router'
import { ArrowRight, EyeOff, Loader2, RefreshCw, Settings2 } from 'lucide-react'
import { useState } from 'react'

import { useDocumentTitle } from '@/components/document-title'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { getCurrency } from '@/lib/currency'

import {
  usePersonalProfile,
  usePersonalSources,
  useReconcilePersonalSources,
  useUpdatePersonalProfile,
  useUpdatePersonalSourceRule,
} from './api'
import { usePersonalTranslation } from './personal-i18n'
import type { PersonalSourceGroup } from './types'

const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CHF',
  'JPY',
  'CAD',
  'AUD',
  'PLN',
  'CZK',
  'SEK',
  'NOK',
  'DKK',
  'BRL',
  'MXN',
  'INR',
  'KRW',
  'SGD',
  'HKD',
  'NZD',
  'ZAR',
]

const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
]

function currencyOptions(current: string): string[] {
  const codes = new Set([...COMMON_CURRENCIES, current])
  return [...codes].filter((code) => getCurrency(code) ?? code === current)
}

function timeZoneOptions(current: string): string[] {
  return current && !COMMON_TIMEZONES.includes(current)
    ? [current, ...COMMON_TIMEZONES]
    : COMMON_TIMEZONES
}

/**
 * Settings: profile currency/timezone (currency locks once entries exist), the
 * shared-expenses master switch, per-group include rules with an include-from
 * month, a manual reconcile action, and an excluded-expenses placeholder until
 * the API exposes overrides.
 */
export function PersonalSettingsPage() {
  const { t } = usePersonalTranslation()
  useDocumentTitle(t('settings.documentTitle'))
  const { toast } = useToast()

  const profileQuery = usePersonalProfile()
  const sourcesQuery = usePersonalSources()
  const updateProfile = useUpdatePersonalProfile()
  const updateRule = useUpdatePersonalSourceRule()
  const reconcile = useReconcilePersonalSources()

  const [drafts, setDrafts] = useState<
    Record<string, { included: boolean; includeFrom: string }>
  >({})

  const profile = profileQuery.data ?? sourcesQuery.data?.profile
  const groups = sourcesQuery.data?.groups ?? []
  const hasData = profile?.canChangeCurrency === false
  const savingProfile = updateProfile.isPending

  function draftFor(group: PersonalSourceGroup) {
    return (
      drafts[group.groupId] ?? {
        included: group.included,
        includeFrom: group.includeFrom?.slice(0, 7) ?? '',
      }
    )
  }

  function fail(error: unknown) {
    toast({
      description:
        error instanceof Error ? error.message : t('settings.saveFailed'),
      variant: 'destructive',
    })
  }

  if (profileQuery.isPending || sourcesQuery.isPending) {
    return (
      <div
        className="flex flex-col gap-4"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <div className="h-56 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (profileQuery.isError || sourcesQuery.isError || !profile) {
    const error = profileQuery.error ?? sourcesQuery.error
    return (
      <Card className="border-destructive/30">
        <CardContent
          spacing="standalone"
          className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"
        >
          <p role="alert" className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : t('settings.error')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void profileQuery.refetch()
              void sourcesQuery.refetch()
            }}
          >
            <RefreshCw className="me-2 size-4" aria-hidden="true" />
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Card>
        <CardHeader className="space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {t('settings.profileTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="personal-settings-currency">
              {t('settings.currency')}
            </Label>
            <Select
              value={profile.currencyCode}
              items={currencyOptions(profile.currencyCode).map((code) => ({
                value: code,
                label: code,
              }))}
              disabled={hasData || savingProfile}
              onValueChange={(value) => {
                if (!value || value === profile.currencyCode) return
                void updateProfile
                  .mutateAsync({ currencyCode: value })
                  .then(() => toast({ description: t('settings.saved') }))
                  .catch(fail)
              }}
            >
              <SelectTrigger id="personal-settings-currency" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencyOptions(profile.currencyCode).map((code) => (
                  <SelectItem key={code} value={code}>
                    {code} · {getCurrency(code)?.symbol ?? ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {hasData
                ? t('settings.currencyLocked')
                : t('settings.currencyHint')}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="personal-settings-timezone">
              {t('settings.timeZone')}
            </Label>
            <Select
              value={profile.timeZone}
              items={timeZoneOptions(profile.timeZone).map((zone) => ({
                value: zone,
                label: zone.replace(/_/g, ' '),
              }))}
              disabled={savingProfile}
              onValueChange={(value) => {
                if (!value || value === profile.timeZone) return
                void updateProfile
                  .mutateAsync({ timeZone: value })
                  .then(() => toast({ description: t('settings.saved') }))
                  .catch(fail)
              }}
            >
              <SelectTrigger id="personal-settings-timezone" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeZoneOptions(profile.timeZone).map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('settings.timeZoneHint')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-0 pb-2">
          <CardTitle className="text-base">
            {t('settings.sharedTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="personal-settings-shared">
                {t('settings.sharedToggle')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.sharedDescription')}
              </p>
            </div>
            <Switch
              id="personal-settings-shared"
              checked={profile.sharedEnabled}
              disabled={savingProfile}
              onCheckedChange={(checked) => {
                void updateProfile
                  .mutateAsync({ sharedEnabled: checked === true })
                  .then(() => toast({ description: t('settings.saved') }))
                  .catch(fail)
              }}
            />
          </div>

          {profile.sharedEnabled ? (
            groups.length > 0 ? (
              <ul className="divide-y divide-border/60">
                {groups.map((group) => {
                  const draft = draftFor(group)
                  const dirty =
                    draft.included !== group.included ||
                    (draft.includeFrom || '') !==
                      (group.includeFrom?.slice(0, 7) ?? '')
                  return (
                    <li
                      key={group.groupId}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <Checkbox
                          checked={draft.included}
                          disabled={updateRule.isPending}
                          onCheckedChange={(checked) =>
                            setDrafts((current) => ({
                              ...current,
                              [group.groupId]: {
                                ...draftFor(group),
                                ...draft,
                                included: checked === true,
                              },
                            }))
                          }
                          aria-label={t('settings.includeGroup', {
                            name: group.name,
                          })}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {group.name}
                          </span>
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {t('settings.groupMeta', {
                              members: group.memberCount,
                              expenses: group.expenseCount,
                            })}
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ps-8 sm:ps-0">
                        <Label
                          htmlFor={`personal-include-from-${group.groupId}`}
                          className="sr-only"
                        >
                          {t('settings.includeFrom', { name: group.name })}
                        </Label>
                        <Input
                          id={`personal-include-from-${group.groupId}`}
                          type="month"
                          className="h-9 w-44"
                          disabled={!draft.included || updateRule.isPending}
                          value={draft.includeFrom}
                          placeholder={t('settings.includeFromPlaceholder')}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [group.groupId]: {
                                ...draft,
                                includeFrom: event.target.value,
                              },
                            }))
                          }
                        />
                        {dirty && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={updateRule.isPending}
                            onClick={() => {
                              void updateRule
                                .mutateAsync({
                                  groupId: group.groupId,
                                  included: draft.included,
                                  includeFrom: draft.includeFrom
                                    ? `${draft.includeFrom}-01`
                                    : null,
                                })
                                .then(() => {
                                  setDrafts((current) => {
                                    const next = { ...current }
                                    delete next[group.groupId]
                                    return next
                                  })
                                  toast({
                                    description: t('settings.saved'),
                                  })
                                })
                                .catch(fail)
                            }}
                          >
                            {updateRule.isPending ? (
                              <Loader2
                                className="size-4 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              t('settings.saveRule')
                            )}
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('settings.noGroups')}
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('settings.sharedOffHint')}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reconcile.isPending || !profile.sharedEnabled}
              onClick={() => {
                void reconcile
                  .mutateAsync()
                  .then((result) =>
                    toast({
                      description: t('settings.reconciled', {
                        count: result.synced,
                      }),
                    }),
                  )
                  .catch(fail)
              }}
            >
              {reconcile.isPending ? (
                <Loader2
                  className="me-2 size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw className="me-2 size-4" aria-hidden="true" />
              )}
              {t('settings.reconcile')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('settings.reconcileHint')}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <EyeOff
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {t('settings.excludedTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t('settings.excludedPlaceholder')}
          </p>
        </CardContent>
      </Card>

      <Link
        to="/account/settings"
        className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent"
      >
        <span className="font-medium">{t('settings.accountSettings')}</span>
        <ArrowRight
          className="size-4 text-muted-foreground rtl:rotate-180"
          aria-hidden="true"
        />
      </Link>
    </div>
  )
}
