import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import {
  AppliedExchangeRates,
  type AppliedExchangeRateMode,
} from '@/components/applied-exchange-rates'
import {
  CurrencyConversionWizard,
  type ConversionPair,
  type CurrencyConversionWizardResult,
} from '@/components/currency-conversion-wizard'
import { CurrencySelector } from '@/components/currency-selector'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import { useCurrencies } from '@/lib/currency'
import { trpc } from '@/trpc/client'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function CurrencyMigrationPage() {
  const { groupId, group, currentMember } = useCurrentGroup()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { toast } = useToast()
  const [destination, setDestination] = useState('')
  const [conversion, setConversion] =
    useState<CurrencyConversionWizardResult | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const currencies = useCurrencies('', undefined)
  const utils = trpc.useUtils()
  const currentCurrencyCode = group?.currencyCode ?? ''

  useEffect(() => {
    if (currentCurrencyCode) {
      setDestination((value) => value || currentCurrencyCode)
    }
  }, [currentCurrencyCode])

  const previewQuery = trpc.groups.migrateCurrencyPreview.useQuery(
    { groupId, destinationCurrencyCode: destination },
    {
      enabled: !!destination && destination !== currentCurrencyCode,
      retry: false,
    },
  )
  const migrationMutation = trpc.groups.migrateCurrency.useMutation({
    onSuccess: async () => {
      await Promise.all([
        // Reset, rather than merely invalidate, because the destination pages
        // can mount query variants that were fetched earlier (with an invite
        // token or a specific expense id). Removing their cached data avoids
        // rendering pre-migration amounts during the next navigation.
        utils.groups.get.reset(),
        utils.groups.getDetails.reset(),
        utils.groups.activities.list.reset(),
        utils.groups.expenses.list.reset(),
        utils.groups.expenses.get.reset(),
        utils.groups.balances.list.reset(),
        utils.groups.stats.get.reset(),
        utils.groups.leavePreview.reset(),
        utils.groups.migrateCurrencyPreview.reset(),
        utils.invitations.revokePreview.reset(),
        utils.account.groups.reset(),
      ])
      toast({ description: t('Groups.CurrencyMigration.success') })
      navigate({ to: '/groups/$groupId/edit', params: { groupId } })
    },
    onError: (error) =>
      toast({ description: error.message, variant: 'destructive' }),
  })

  const preview = previewQuery.data
  const pairs = useMemo<ConversionPair[]>(
    () =>
      preview?.pairs.map((pair) => ({
        base: pair.base,
        target: pair.target,
        dates: pair.dates,
      })) ?? [],
    [preview?.pairs],
  )
  const appliedRateModes = useMemo<Record<string, AppliedExchangeRateMode>>(
    () =>
      Object.fromEntries(
        Object.entries(conversion?.policies ?? {}).map(([key, policy]) => [
          key,
          policy.type === 'perDate' ? 'perDate' : 'fixed',
        ]),
      ),
    [conversion?.policies],
  )
  const hasConversions = pairs.length > 0

  if (currentMember?.role !== 'ADMIN') {
    return (
      <Card>
        <CardContent className="p-6">
          {t('Groups.Unauthorized.description')}
        </CardContent>
      </Card>
    )
  }

  if (!group) {
    return <Loader2 className="h-5 w-5 animate-spin" />
  }

  const submit = () => {
    if (!conversion?.ready || !acknowledged || !preview) return
    const pairChoices: Record<
      string,
      | { type: 'perDate' }
      | { type: 'fixedProvider'; date: string }
      | { type: 'fixedCustom'; rate: number }
    > = {}
    for (const [key, policy] of Object.entries(conversion.policies)) {
      if (policy.type === 'fixedCustom') {
        if (policy.rate === undefined) return
        pairChoices[key] = { type: 'fixedCustom', rate: policy.rate }
      } else {
        pairChoices[key] = policy
      }
    }
    migrationMutation.mutate({
      groupId,
      destinationCurrencyCode: preview.destinationCurrencyCode,
      pairChoices,
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">
          {t('Groups.CurrencyMigration.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Groups.CurrencyMigration.description')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('Groups.CurrencyMigration.destinationLabel')}
          </CardTitle>
          <CardDescription>
            {t('Groups.CurrencyMigration.currentCurrency', {
              currency: group.currencyCode ?? group.currency,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CurrencySelector
            currencies={currencies}
            defaultValue={destination || currentCurrencyCode}
            disabled={previewQuery.isFetching || reviewing}
            isLoading={false}
            onValueChange={(value) => {
              setDestination(value)
              setConversion(null)
              setReviewing(false)
              setAcknowledged(false)
            }}
          />
          {destination === currentCurrencyCode ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('Groups.CurrencyMigration.noDestination')}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {previewQuery.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : null}
      {previewQuery.error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {previewQuery.error.message}
          </CardContent>
        </Card>
      ) : null}
      {preview && !preview.eligible ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>
              {preview.unsupportedCurrencies.length > 0
                ? t('Groups.CurrencyMigration.unsupportedTitle')
                : t('Groups.CurrencyMigration.noDestination')}
            </CardTitle>
            <CardDescription>
              {preview.unsupportedCurrencies.length > 0
                ? t('Groups.CurrencyMigration.unsupportedDescription')
                : t('Groups.CurrencyMigration.noDestination')}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {preview.unsupportedCurrencies.map((issue) => (
              <p key={issue.code}>
                {t('Groups.CurrencyMigration.unsupportedCode', {
                  code: issue.code,
                  count: issue.expenseIds.length,
                })}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {preview?.eligible && !reviewing ? (
        <div className="flex flex-col gap-4">
          <CurrencyConversionWizard pairs={pairs} onChange={setConversion} />
          <Button
            className="self-end"
            disabled={!conversion?.ready}
            onClick={() => setReviewing(true)}
          >
            {t('Groups.CurrencyMigration.review')}
          </Button>
        </div>
      ) : null}
      {preview?.eligible && reviewing && conversion?.ready ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('Groups.CurrencyMigration.confirmationTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {hasConversions ? (
              <div className="rounded-md border bg-muted/20 p-4">
                <AppliedExchangeRates
                  embedded
                  modes={appliedRateModes}
                  rates={conversion.rates}
                />
              </div>
            ) : null}
            {preview.customRateExpenseCount > 0 ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                {t('Groups.CurrencyMigration.customWarning', {
                  count: preview.customRateExpenseCount,
                })}
              </p>
            ) : null}
            {hasConversions ? (
              <p className="text-muted-foreground">
                {t('Groups.CurrencyMigration.serverWarning')}
              </p>
            ) : null}
            <label className="flex items-start gap-2">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(value) => setAcknowledged(value === true)}
              />
              <span>{t('Groups.CurrencyMigration.acknowledgement')}</span>
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setReviewing(false)}>
                {t('Groups.CurrencyMigration.back')}
              </Button>
              <Button
                disabled={!acknowledged || migrationMutation.isPending}
                onClick={submit}
              >
                {migrationMutation.isPending
                  ? t('Groups.CurrencyMigration.migrating')
                  : t('Groups.CurrencyMigration.migrate')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
