import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from '@tanstack/react-router'
import { Save, UserPlus } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
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
import type { AccountPreferences } from '@/lib/account-preferences'
import type { getGroup } from '@/lib/api'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { useDeploymentConfig } from '@/lib/deployment-config'
import type { GroupFormValues } from '@/lib/schemas'
import { groupFormSchema } from '@/lib/schemas'

import { CurrencySelector } from './currency-selector'
import { Textarea } from './ui/textarea'

export type Props = {
  group?: NonNullable<Awaited<ReturnType<typeof getGroup>>>
  /**
   * Current caller's role on the group (when editing an existing group). When
   * set to `MEMBER`, the form renders in a read-only state: the input controls
   * are disabled, no Save button is shown, and a small note explains the
   * restriction. Inviting members is done from the Members tab; this form no
   * longer collects pending invitations.
   */
  currentMemberRole?: 'ADMIN' | 'MEMBER'
  /**
   * Explicit group-wide access mode. Unlike `currentMemberRole`, this also
   * covers pending invitations, public links, and a future view-only member.
   */
  readOnly?: boolean
  /**
   * When `true`, the group is archived and its settings are frozen. All inputs
   * are disabled and no Save button is shown. Archived groups are not editable
   * from this form even for ADMIN — unarchive the group first.
   */
  archived?: boolean
  /**
   * When `true`, hide the "After the group is created, open the Members tab to
   * invite people" hint. The import wizard renders this form inline and
   * surfaces invites on its own Done step, so the hint would be misleading
   * there.
   */
  hideInviteHint?: boolean
  /**
   * When provided, applied to the `<form>` element's `id` so external buttons
   * (e.g. a wizard-shell Continue) can submit the form via the native HTML
   * `form` attribute without being nested inside it.
   */
  formId?: string
  /**
   * Hide the in-form Save / Cancel actions so a parent (e.g. the import wizard)
   * can render its own Continue button at the shell level. The form is still
   * validatable and submit-on-Enter still works.
   */
  hideActions?: boolean
  /**
   * When `true`, the name input is hidden entirely. Used for FRIEND-typed
   * ledgers, where the name is fixed by the system and should not be shown in
   * the settings form.
   */
  hideNameField?: boolean
  /**
   * When `true`, the name input is rendered as disabled (read-only) so the
   * field cannot be edited.
   */
  nameReadOnly?: boolean
  /**
   * When `true`, the group already contains expenses and the currency selector
   * is disabled with a small note. The backend rejects any currency change
   * after expenses exist; this surfaces that on the UI.
   */
  currencyLocked?: boolean
  /**
   * Optional initial values for a brand-new group. Only used when `group` is
   * unset — the import wizard pre-fills the name, currency, and a default
   * "imported from Spliit" note so the user can hit Create without re-typing.
   * Edits to the form still flow through normally.
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
 * Cloud groups are account-backed. The current account becomes the group ADMIN
 * on create, and additional members join through invitations.
 *
 * The `groupFormSchema` still requires a non-empty `participants` array, but
 * the backend ignores it on create/edit; we satisfy the schema with a stable
 * placeholder so the form always validates, even when the current account has
 * no display name yet (which previously made the create button silently do
 * nothing).
 */
const PARTICIPANTS_PLACEHOLDER = [{ name: 'Owner' }]
type GroupFormInput = z.input<typeof groupFormSchema>

export function GroupForm({
  group,
  currentMemberRole,
  readOnly: explicitReadOnly,
  archived = false,
  hideInviteHint = false,
  initialValues,
  formId,
  hideActions = false,
  hideNameField = false,
  nameReadOnly = false,
  currencyLocked = false,
  onSubmit,
}: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'GroupForm' })
  const readOnly =
    !!group && (explicitReadOnly ?? currentMemberRole === 'MEMBER')
  const isArchived = !!group && archived
  const accountPreferences =
    useSyncedAccountPreferences() as AccountPreferences | null
  const deploymentCurrencyCode = useDeploymentConfig().defaultCurrencyCode
  const initialCurrencyCode =
    initialValues?.currencyCode ??
    accountPreferences?.defaultCurrencyCode ??
    deploymentCurrencyCode

  const form = useForm<GroupFormInput, unknown, GroupFormValues>({
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
            getCurrency(initialCurrencyCode || 'USD')?.symbol ??
            '',
          currencyCode: initialCurrencyCode,
          participants: PARTICIPANTS_PLACEHOLDER,
        },
  })

  useEffect(() => {
    if (group || !accountPreferences) return
    const currencyCodeState = form.getFieldState('currencyCode')
    const currencyState = form.getFieldState('currency')
    const currencyWasEdited =
      currencyCodeState.isDirty ||
      currencyCodeState.isTouched ||
      currencyState.isDirty ||
      currencyState.isTouched
    if (
      initialValues?.currencyCode === undefined &&
      accountPreferences.defaultCurrencyCode &&
      !currencyWasEdited
    ) {
      const code = accountPreferences.defaultCurrencyCode
      form.setValue('currencyCode', code)
      form.setValue('currency', getCurrency(code)?.symbol ?? '')
    }
  }, [accountPreferences, form, group, initialValues])

  const currencies = useCurrencies(
    t('CurrencyCodeField.customOption'),
    form.watch('currency') || undefined,
  )

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
          <p className="mb-4 text-sm text-muted-foreground">
            {t('archivedNotice')}
          </p>
        )}
        {readOnly && !isArchived && (
          <p className="mb-4 text-sm text-muted-foreground">
            {t('readOnlyNote')}
          </p>
        )}

        <Card className="mb-2">
          <CardHeader className="hidden sm:flex">
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 sm:p-6 sm:pt-0">
            {!hideNameField && (
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
            )}

            <FormField
              control={form.control}
              name="currencyCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('CurrencyCodeField.label')}</FormLabel>
                  <CurrencySelector
                    aria-label={t('CurrencyCodeField.label')}
                    currencies={currencies}
                    defaultValue={form.watch(field.name) ?? ''}
                    pinnedCurrencyCode={form.watch(field.name) ?? undefined}
                    disabled={readOnly || isArchived || currencyLocked}
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
                  <FormDescription>
                    {currencyLocked
                      ? t('CurrencyCodeField.lockedAfterExpenses')
                      : t(
                          group
                            ? 'CurrencyCodeField.editDescription'
                            : 'CurrencyCodeField.createDescription',
                        )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem hidden={!!form.watch('currencyCode')?.length}>
                  <FormLabel>{t('CurrencyField.label')}</FormLabel>
                  <FormControl>
                    <Input
                      className="text-base"
                      placeholder={t('CurrencyField.placeholder')}
                      max={5}
                      disabled={readOnly || isArchived}
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

            <div className="sm:col-span-2">
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
            <CardContent className="flex flex-col gap-3 pt-4 sm:p-6 sm:pt-0">
              <div className="flex gap-2">
                <SubmitButton
                  className="flex-1 sm:flex-none"
                  loadingContent={t(
                    group ? 'Settings.saving' : 'Settings.creating',
                  )}
                >
                  <Save className="me-2 h-4 w-4" />{' '}
                  {t(group ? 'Settings.save' : 'Settings.create')}
                </SubmitButton>
                {!group && (
                  <Button
                    variant="ghost"
                    className="hidden sm:inline-flex"
                    nativeButton={false}
                    render={<Link to="/" />}
                  >
                    {t('Settings.cancel')}
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
