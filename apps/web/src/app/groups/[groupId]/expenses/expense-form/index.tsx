import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import {
  useForm,
  useWatch,
  type FieldErrors,
  type FieldPath,
  type Resolver,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { Form } from '@/components/ui/form'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { getCurrency } from '@/lib/currency'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import {
  expenseFormInputSchema,
  type Expense,
  type ExpenseFormInputValues,
} from '@/lib/schemas'
import { dateOnlyInAccountTimeZone, getCurrencyFromGroup } from '@/lib/utils'
import type { CreateExpenseSearch } from '@/router/schemas'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import { amountAsDecimal, type Currency } from '@spliit/domain'

import type {
  ReceiptDocument,
  ReceiptExtractedInfo,
  ReceiptScanContext,
} from '../create-from-receipt-button'
import { BasicDetailsCard } from './basic-details-card'
import { type SavedSplit } from './default-split/split-equal'
import {
  buildExpenseFormDefaults,
  savedDefaultToFormValues,
} from './default-values'
import { DocumentsCard } from './documents-card'
import { ExpenseItemsCard } from './expense-items-card'
import { FormActions } from './form-actions'
import { ItemParticipantsModal } from './item-participants-modal'
import { PaidByCard } from './paid-by-card'
import { PaidForCard } from './paid-for-card'
import { buildSubmitValues } from './submit-values'
import { useExpenseCurrencyConversion } from './use-expense-currency-conversion'
import { useExpenseFormBalancing } from './use-expense-form-balancing'

function firstErrorPath(errors: FieldErrors, prefix = ''): string | undefined {
  if (!errors || typeof errors !== 'object') return undefined
  for (const [key, value] of Object.entries(errors)) {
    if (key === 'ref' || key === 'types') continue
    const path = prefix ? `${prefix}.${key}` : key
    if (
      value &&
      typeof value === 'object' &&
      'message' in value &&
      (value as { message?: unknown }).message != null
    ) {
      return path
    }
    const childPath = firstErrorPath(value as FieldErrors, path)
    if (childPath) return childPath
  }
  return undefined
}

function focusableErrorPath(path: string): string {
  const itemMatch = path.match(/^items(?:\.(\d+))?/)
  return itemMatch ? `items.${itemMatch[1] ?? 0}.title` : path
}

export function ExpenseForm(props: {
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  expense?: AppRouterOutput['groups']['expenses']['get']['expense']
  isCopy?: boolean
  searchParams?: CreateExpenseSearch
  heading?: string
  /** Internal path to return to when the form was opened from another feed. */
  cancelHref?: string
  onSubmit: (value: Expense) => Promise<void>
  onDelete?: () => Promise<void>
  runtimeFeatureFlags: RuntimeFeatureFlags
  currentLedgerParticipantId?: string | null
  readOnly?: boolean
  /** Link-invite token for pending invitees (currency recommendations). */
  linkInviteToken?: string
  /** Locked series edit scope when editing a recurring expense. */
  editScope?: 'OCCURRENCE' | 'THIS_AND_FUTURE' | null
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'
  const [hasValidationError, setHasValidationError] = useState(false)
  // Copy and fresh-create both surface as a Create flow even though
  // props.expense is set in copy mode (for field prefill).
  const isCreate = props.expense === undefined || props.isCopy === true

  // The persisted per-user-per-group default split is the source of
  // truth for the Load/Save buttons in the PaidFor header on every
  // flow (create / copy / edit / read-only). Form defaults below
  // consume it only in the create branch — `buildExpenseFormDefaults`
  // keeps edit and copy aligned with the loaded expense — but the
  // buttons need to know whether a saved default exists regardless
  // of how the form was opened, so the query runs unconditionally.
  const savedDefaultQuery = trpc.account.defaultSplit.useQuery({
    groupId: props.group.id,
  })
  const savedDefault = savedDefaultQuery.data?.defaultSplit ?? null

  const form = useForm<ExpenseFormInputValues>({
    resolver: zodResolver(
      expenseFormInputSchema,
    ) as Resolver<ExpenseFormInputValues>,
    defaultValues: buildExpenseFormDefaults({
      isCreate,
      expense: props.expense,
      isCopy: props.isCopy,
      searchParams: props.searchParams ?? {},
      group: props.group,
      groupCurrency: getCurrencyFromGroup(props.group),
      currentLedgerParticipantId: props.currentLedgerParticipantId,
      reimbursementTitle: t('reimbursement'),
      savedDefault,
      today: dateOnlyInAccountTimeZone(new Date(), accountTimeZone),
    }),
  })

  const groupCurrency = getCurrencyFromGroup(props.group)

  // `buildExpenseFormDefaults` runs synchronously on first render, but
  // `savedDefault` is `null` until the tRPC query resolves — so fresh
  // create flows open with the neutral (EVENLY) split instead of the
  // user's saved default. Once the query resolves, swap the form into
  // the saved shape so the user doesn't have to click "Load default"
  // manually. Guarded to fresh-create (no edit/copy overwrite) and to
  // a pristine form (never yank values the user has already typed).
  const autoAppliedRef = useRef(false)
  useEffect(() => {
    if (autoAppliedRef.current) return
    if (!isCreate || props.isCopy) return
    if (!savedDefaultQuery.isSuccess || !savedDefault) return
    if (form.formState.isDirty) return
    if (form.getValues('splitMode') === 'ITEMIZED') return
    const restored = savedDefaultToFormValues(
      savedDefault,
      props.group,
      groupCurrency,
    )
    if (!restored) return
    form.setValue('splitMode', restored.splitMode, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('paidFor', restored.paidFor, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    autoAppliedRef.current = true
  }, [
    isCreate,
    props.isCopy,
    props.group,
    groupCurrency,
    savedDefaultQuery.isSuccess,
    savedDefault,
    form,
  ])

  const conversion = useExpenseCurrencyConversion({
    form,
    group: props.group,
    groupCurrency,
    linkInviteToken: props.linkInviteToken,
  })

  const isIncome = conversion.isIncome

  // Income expenses cannot be reimbursements; clear the flag automatically
  // so saving an income expense doesn't accidentally pay the user back.
  useEffect(() => {
    if (isIncome && form.getValues('isReimbursement')) {
      form.setValue('isReimbursement', false)
    }
  }, [isIncome, form])

  const originalCurrencyValue = useWatch({
    control: form.control,
    name: 'originalCurrency',
  })
  const watchedFormValues = useWatch({ control: form.control })
  const payerCurrency: Currency = originalCurrencyValue
    ? (getCurrency(originalCurrencyValue) ?? groupCurrency)
    : groupCurrency

  const { setManuallyEditedParticipants, setManuallyEditedPayers } =
    useExpenseFormBalancing({ form, payerCurrency })

  const sExpense = (isIncome ? 'Income' : 'Expense') as 'Expense' | 'Income'

  const receiptScanContext: ReceiptScanContext = {
    title: watchedFormValues.title || undefined,
    amount: Number(watchedFormValues.amount) || undefined,
    date: watchedFormValues.expenseDate?.toISOString().slice(0, 10),
    currencyCode: watchedFormValues.originalCurrency || groupCurrency.code,
    categoryId: watchedFormValues.category || undefined,
    items: (watchedFormValues.items ?? []).map((item) => ({
      title: item.title ?? '',
      unitPrice: Number(item.unitPrice) || 0,
      quantity: Number(item.quantity) || 1,
    })),
  }

  const applyReceiptResult = ({
    info,
    document,
  }: {
    info: ReceiptExtractedInfo
    document: ReceiptDocument
  }) => {
    const receiptCurrency = info.currencyCode
      ? (getCurrency(info.currencyCode) ?? groupCurrency)
      : groupCurrency
    if (info.title) {
      form.setValue('title', info.title, { shouldDirty: true })
    }
    if (info.amount > 0) {
      form.setValue('amount', amountAsDecimal(info.amount, receiptCurrency), {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
    if (info.date) {
      form.setValue('expenseDate', new Date(`${info.date}T12:00:00`), {
        shouldDirty: true,
      })
    }
    if (info.currencyCode) {
      form.setValue('originalCurrency', receiptCurrency.code, {
        shouldDirty: true,
      })
    }
    if (info.categoryId) {
      form.setValue('category', info.categoryId as never, {
        shouldDirty: true,
      })
    }
    if (info.items.length) {
      form.setValue(
        'items',
        info.items.map((item) => ({
          id: crypto.randomUUID(),
          title: item.title,
          // Receipt line-item prices are returned as major-unit numbers;
          // only the total is normalized to minor units by the API.
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          splitMode: 'EVENLY' as const,
          paidFor: props.group.participants.map((participant) => ({
            participant: participant.id,
            shares: 1,
          })),
        })),
        { shouldDirty: true },
      )
    }
    if (
      !form
        .getValues('documents')
        .some((existing) => existing.url === document.url)
    ) {
      form.setValue('documents', [...form.getValues('documents'), document], {
        shouldDirty: true,
      })
    }
  }

  const submit = async (values: ExpenseFormInputValues) => {
    if (props.readOnly) return
    setHasValidationError(false)
    const rate = Number(values.conversionRate)
    if (
      conversion.conversionRequired &&
      (!rate || Number.isNaN(rate) || rate <= 0)
    ) {
      form.setError('conversionRate', {
        type: 'manual',
        message: 'ratePositive',
      })
      return
    }
    return props.onSubmit(
      buildSubmitValues(values, {
        groupCurrency,
        conversionRequired: conversion.conversionRequired,
      }),
    )
  }

  const handleInvalidSubmit = (errors: FieldErrors<ExpenseFormInputValues>) => {
    setHasValidationError(true)
    const path = firstErrorPath(errors)
    if (!path) return
    form.setFocus(focusableErrorPath(path) as FieldPath<ExpenseFormInputValues>)
    window.setTimeout(() => {
      const active = document.activeElement as HTMLElement | null
      const invalid = document.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      )
      const target = active && active !== document.body ? active : invalid
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit, handleInvalidSubmit)}
        noValidate
        className="-mx-4 w-[calc(100%+2rem)] min-w-0 overflow-x-hidden pb-24 sm:mx-0 sm:w-auto sm:pb-20"
      >
        {props.readOnly && <ReadOnlyNotice />}
        <BasicDetailsCard
          form={form}
          group={props.group}
          readOnly={!!props.readOnly}
          sExpense={sExpense}
          isCreate={isCreate}
          isCopy={props.isCopy}
          recurrenceSequence={
            !props.isCopy
              ? (props.expense?.recurrenceSequence ?? undefined)
              : undefined
          }
          editScope={props.editScope}
          cancelHref={props.cancelHref}
          initialRecurrence={
            !isCreate ? (props.expense?.recurrence ?? null) : undefined
          }
          linkInviteToken={props.linkInviteToken}
          extractCategoryMutation={trpc.ai.extractCategoryFromTitle.useMutation()}
          runtimeFeatureFlags={props.runtimeFeatureFlags}
          receiptDocuments={form.getValues('documents')}
          receiptScanContext={receiptScanContext}
          onReceiptAccepted={applyReceiptResult}
          heading={props.heading}
          {...conversion}
          groupCurrency={groupCurrency}
          savedDefault={savedDefault}
        />
        <ExpenseItemsCard
          form={form}
          group={props.group}
          groupCurrency={payerCurrency}
          readOnly={!!props.readOnly}
          savedDefault={savedDefault}
          renderItemParticipantsModal={({
            itemIndex,
            item,
            open,
            onClose,
            onSaveItem,
            titleOverride,
            hideAmountDescription,
            hideAmountMode,
            savedDefault,
          }) => (
            <ItemParticipantsModal
              open={open}
              onOpenChange={(v) => !v && onClose()}
              form={form}
              itemIndex={itemIndex}
              group={props.group}
              groupCurrency={payerCurrency}
              item={item}
              onSaveItem={onSaveItem}
              readOnly={!!props.readOnly}
              titleOverride={titleOverride}
              hideAmountDescription={hideAmountDescription}
              hideAmountMode={hideAmountMode}
              savedDefault={(savedDefault ?? null) as SavedSplit | null}
            />
          )}
        />
        <PaidForCard
          form={form}
          group={props.group}
          groupCurrency={groupCurrency}
          payerCurrency={payerCurrency}
          readOnly={!!props.readOnly}
          sExpense={sExpense}
          setManuallyEditedParticipants={setManuallyEditedParticipants}
          savedDefault={savedDefault}
          isCreate={isCreate}
        />
        <PaidByCard
          form={form}
          group={props.group}
          groupCurrency={groupCurrency}
          payerCurrency={payerCurrency}
          readOnly={!!props.readOnly}
          sExpense={sExpense}
          setManuallyEditedPayers={setManuallyEditedPayers}
        />
        {props.runtimeFeatureFlags.enableExpenseDocuments && (
          <DocumentsCard
            form={form}
            group={props.group}
            readOnly={!!props.readOnly}
            sExpense={sExpense}
            enableReceiptExtract={
              props.runtimeFeatureFlags.enableReceiptExtract
            }
            receiptContext={receiptScanContext}
            onReceiptAccepted={applyReceiptResult}
          />
        )}
        {hasValidationError && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {t('validationSummary')}
          </div>
        )}
        <FormActions
          isCreate={isCreate}
          readOnly={!!props.readOnly}
          onDelete={props.onDelete}
          cancelHref={props.cancelHref ?? `/groups/${props.group.id}`}
        />
      </form>
    </Form>
  )
}

function ReadOnlyNotice() {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  return (
    <p className="mb-4 text-sm text-muted-foreground">{t('readOnlyNotice')}</p>
  )
}
