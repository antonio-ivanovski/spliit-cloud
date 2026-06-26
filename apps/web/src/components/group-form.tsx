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
import { useLocale } from '@/i18n/react'
import { Locale } from '@/i18n/request'
import { getGroup } from '@/lib/api'
import { defaultCurrencyList, getCurrency } from '@/lib/currency'
import { GroupFormValues, groupFormSchema } from '@/lib/schemas'
import { zodResolver } from '@hookform/resolvers/zod'
import { Save, UserPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { CurrencySelector } from './currency-selector'
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
  onSubmit,
}: Props) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'GroupForm' })
  const readOnly = !!group && currentMemberRole === 'MEMBER'
  const isArchived = !!group && archived

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
          name: '',
          information: '',
          currency: '',
          currencyCode: import.meta.env.VITE_DEFAULT_CURRENCY_CODE || 'USD',
          participants: PARTICIPANTS_PLACEHOLDER,
        },
  })

  return (
    <Form {...form}>
      <form
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

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      disabled={readOnly || isArchived}
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

            <FormField
              control={form.control}
              name="currencyCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('CurrencyCodeField.label')}</FormLabel>
                  <CurrencySelector
                    currencies={defaultCurrencyList(
                      locale as Locale,
                      t('CurrencyCodeField.customOption'),
                    )}
                    defaultValue={form.watch(field.name) ?? ''}
                    disabled={readOnly || isArchived}
                    onValueChange={(newCurrency) => {
                      field.onChange(newCurrency)
                      const currency = getCurrency(newCurrency)
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
                    {t(
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

            <div className="col-span-2">
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
        </Card>

        {!group && (
          <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <UserPlus className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('Settings.inviteAfterCreate')}</span>
          </p>
        )}

        {!readOnly && !isArchived && (
          <div className="mt-4 flex flex-col gap-3">
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
                  <Link href="/groups">{t('Settings.cancel')}</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </form>
    </Form>
  )
}
