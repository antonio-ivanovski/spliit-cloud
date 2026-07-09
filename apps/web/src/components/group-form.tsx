import Link from '@/components/link'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { getGroup } from '@/lib/api'
import { getCurrency, useCurrencies } from '@/lib/currency'
import type { GroupFormValues } from '@/lib/schemas'
import { groupFormSchema } from '@/lib/schemas'
import { zodResolver } from '@hookform/resolvers/zod'
import { Save, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { CurrencyLabel, CurrencySelector } from './currency-selector'
import { Textarea } from './ui/textarea'

export type Props = {
  group?: NonNullable<Awaited<ReturnType<typeof getGroup>>>
  /**
   * Current caller's role on the group (when editing an existing group).
   * When set to `MEMBER`, the form renders in a read-only state: the
   * input controls are disabled, no Save button is shown, and a small
   * note explains the restriction. Inviting members is done from the
   * Members tab; this form no longer collects pending invitations.
   */
  currentMemberRole?: 'ADMIN' | 'MEMBER'
  /**
   * When `true`, the group is archived and its settings are frozen.
   * All inputs are disabled and no Save button is shown. Archived
   * groups are not editable from this form even for ADMIN —
   * unarchive the group first.
   */
  archived?: boolean
  /**
   * When `true`, hide the "After the group is created, open the
   * Members tab to invite people" hint. The import wizard renders
   * this form inline and surfaces invites on its own Done step, so
   * the hint would be misleading there.
   */
  hideInviteHint?: boolean
  /**
   * When provided, applied to the `<form>` element's `id` so external
   * buttons (e.g. a wizard-shell Continue) can submit the form via the
   * native HTML `form` attribute without being nested inside it.
   */
  formId?: string
  /**
   * Hide the in-form Save / Cancel actions so a parent (e.g. the
   * import wizard) can render its own Continue button at the shell
   * level. The form is still validatable and submit-on-Enter still
   * works.
   */
  hideActions?: boolean
  /**
   * When `true`, the name input is hidden entirely. Used for FRIEND-typed
   * ledgers, where the name is fixed by the system and should not be shown
   * in the settings form.
   */
  hideNameField?: boolean
  /**
   * When `true`, the name input is rendered as disabled (read-only) so
   * the field cannot be edited.
   */
  nameReadOnly?: boolean
  /**
   * When `true`, the group already contains expenses and the currency is
   * only shown as read-only. The migration action is supplied separately.
   */
  currencyLocked?: boolean
  /**
   * Link rendered beside a locked currency, allowing an admin to start the
   * guided migration flow.
   */
  currencyMigrationHref?: string
  /**
   * Optional initial values for a brand-new group. Only used when
   * `group` is unset — the import wizard pre-fills the name,
   * currency, and a default "imported from Spliit" note so the
   * user can hit Create without re-typing. Edits to the form
   * still flow through normally.
   */
  initialValues?: {
    name?: string
    information?: string
    currency?: string
    currencyCode?: string
  }
  onSubmit: (groupFormValues: GroupFormValues) => Promise<void>
}

/**
 * Cloud groups are account-backed. The current account becomes the group
 * ADMIN on create, and additional members join through invitations.
 *
 * The `groupFormSchema` still requires a non-empty `participants` array, but
 * the backend ignores it on create/edit; we satisfy the schema with a stable
 * placeholder so the form always validates, even when the current account has
 * no display name yet (which previously made the create button silently do
 * nothing).
 */
const PARTICIPANTS_PLACEHOLDER = [{ name: 'Owner' }]

export function GroupForm({
  group,
  currentMemberRole,
  archived = false,
  hideInviteHint = false,
  initialValues,
  formId,
  hideActions = false,
  hideNameField = false,
  nameReadOnly = false,
  currencyLocked = false,
  currencyMigrationHref,
  onSubmit,
}: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'GroupForm' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const readOnly = !!group && currentMemberRole === 'MEMBER'
  const isArchived = !!group && archived
  const [currencyEditing, setCurrencyEditing] = useState(!group)

  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: group
      ? {
          name: group.name,
          information: group.information ?? '',
          currency: group.currency ?? '',
          currencyCode: group.currencyCode ?? '',
          // The backend ignores `participants` on update; the form's
          // hidden `groupFormSchema.participants` validation only needs a
          // stable placeholder. The group.participants array mixes in
          // synthetic rows for pending invitations (with the invitee
          // email as the name), which can exceed the schema's 50-char
          // limit and break owner/admin saves with no visible field to
          // fix.
          participants: PARTICIPANTS_PLACEHOLDER,
        }
      : {
          name: initialValues?.name ?? '',
          information: initialValues?.information ?? '',
          currency:
            initialValues?.currency ??
            getCurrency(
              (initialValues?.currencyCode ??
                import.meta.env.VITE_DEFAULT_CURRENCY_CODE) ||
                'USD',
            )?.symbol ??
            '',
          currencyCode:
            initialValues?.currencyCode ??
            (import.meta.env.VITE_DEFAULT_CURRENCY_CODE || 'USD'),
          participants: PARTICIPANTS_PLACEHOLDER,
        },
  })

  const currencies = useCurrencies(
    t('CurrencyCodeField.customOption'),
    form.watch('currency') || undefined,
  )
  const currencyCode = form.watch('currencyCode')
  const currencyValue = form.watch('currency')
  const selectedCurrency =
    currencies.find((currency) => currency.code === currencyCode) ??
    currencies.find(
      (currency) => !currency.code && currency.symbol === currencyValue,
    ) ??
    currencies[0]
  const showCurrencyReadOnly = !!group && !currencyEditing
  const canEditCurrency = !!group && !readOnly && !isArchived && !currencyLocked

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={form.handleSubmit(async (values) => {
          if (readOnly || isArchived) return
          await onSubmit(values)
        })}
      >
        {isArchived && (
          <p className="text-sm text-muted-foreground mb-4">
            {t('archivedNotice')}
          </p>
        )}
        {readOnly && !isArchived && (
          <p className="text-sm text-muted-foreground mb-4">
            {t('readOnlyNote')}
          </p>
        )}

        <Card className="mb-3">
          <CardHeader className="px-5 pb-2 pt-5">
            <CardTitle className="text-lg">{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 px-5 pb-5 pt-3">
            {!hideNameField && (
              <div>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('NameField.label')}</FormLabel>
                      <FormControl>
                        <Input
                          className="text-base"
                          placeholder={t('NameField.placeholder')}
                          disabled={readOnly || isArchived || nameReadOnly}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('NameField.description')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className="rounded-lg bg-muted/[0.35] px-4 py-3">
              <FormField
                control={form.control}
                name="currencyCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('CurrencyCodeField.label')}</FormLabel>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        {showCurrencyReadOnly ? (
                          <div className="flex min-h-10 items-center px-1 text-sm">
                            {selectedCurrency ? (
                              <CurrencyLabel currency={selectedCurrency} />
                            ) : (
                              <span>{currencyValue}</span>
                            )}
                          </div>
                        ) : (
                          <CurrencySelector
                            currencies={currencies}
                            defaultValue={form.watch(field.name) ?? ''}
                            disabled={readOnly || isArchived}
                            onValueChange={(newCurrency) => {
                              field.onChange(newCurrency)
                              const currency =
                                getCurrency(newCurrency) ??
                                ({
                                  code: '',
                                  symbol: '',
                                  rounding: 0,
                                  decimal_digits: 2,
                                } as const)
                              if (
                                currency.code.length ||
                                form.getFieldState('currency').isTouched
                              )
                                form.setValue('currency', currency.symbol, {
                                  shouldValidate: true,
                                  shouldTouch: true,
                                  shouldDirty: true,
                                })
                            }}
                            isLoading={false}
                          />
                        )}
                      </div>
                      {canEditCurrency && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (currencyEditing) {
                              form.resetField('currencyCode')
                              form.resetField('currency')
                            }
                            setCurrencyEditing(!currencyEditing)
                          }}
                        >
                          {currencyEditing
                            ? t('CurrencyCodeField.cancelChange')
                            : t('CurrencyCodeField.changeAction')}
                        </Button>
                      )}
                      {showCurrencyReadOnly && currencyMigrationHref && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          asChild
                        >
                          <Link href={currencyMigrationHref}>
                            {tGroups('CurrencyMigration.changeAction')}
                          </Link>
                        </Button>
                      )}
                    </div>
                    {!group && (
                      <FormDescription>
                        {t('CurrencyCodeField.createDescription')}
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div hidden={!!form.watch('currencyCode')?.length}>
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('CurrencyField.label')}</FormLabel>
                    <FormControl>
                      <Input
                        className="text-base"
                        placeholder={t('CurrencyField.placeholder')}
                        max={5}
                        disabled={readOnly || isArchived || currencyLocked}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('CurrencyField.description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div>
              <FormField
                control={form.control}
                name="information"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('InformationField.label')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        className="text-base"
                        disabled={readOnly || isArchived}
                        {...field}
                        placeholder={t('InformationField.placeholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>

          {!hideActions && !readOnly && !isArchived && (
            <CardContent className="flex flex-col gap-3 border-t bg-muted/[0.04] px-5 py-4">
              <div className="flex gap-2">
                <SubmitButton
                  loadingContent={t(
                    group ? 'Settings.saving' : 'Settings.creating',
                  )}
                >
                  <Save className="w-4 h-4 mr-2" />{' '}
                  {t(group ? 'Settings.save' : 'Settings.create')}
                </SubmitButton>
                {!group && (
                  <Button variant="ghost" asChild>
                    <Link href="/">{t('Settings.cancel')}</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          )}
        </Card>

        {!group && !hideInviteHint && (
          <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <UserPlus className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('Settings.inviteAfterCreate')}</span>
          </p>
        )}
      </form>
    </Form>
  )
}
