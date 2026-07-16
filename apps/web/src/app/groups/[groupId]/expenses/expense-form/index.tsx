import { Form } from '@/components/ui/form'
import { getCurrency } from '@/lib/currency'
import type { RuntimeFeatureFlags } from '@/lib/featureFlags'
import {
  expenseFormInputSchema,
  type Expense,
  type ExpenseFormInputValues,
} from '@/lib/schemas'
import { getCurrencyFromGroup } from '@/lib/utils'
import type { CreateExpenseSearch } from '@/router/schemas'
import { trpc } from '@/trpc/client'
import { zodResolver } from '@hookform/resolvers/zod'
import type { AppRouterOutput } from '@spliit/api/router'
import { amountAsDecimal, type Currency } from '@spliit/domain'
import { useEffect } from 'react'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type {
  ReceiptDocument,
  ReceiptExtractedInfo,
  ReceiptScanContext,
} from '../create-from-receipt-button'
import { BasicDetailsCard } from './basic-details-card'
import { buildExpenseFormDefaults } from './default-values'
import { DocumentsCard } from './documents-card'
import { ExpenseItemsCard } from './expense-items-card'
import { FormActions } from './form-actions'
import { ItemParticipantsModal } from './item-participants-modal'
import { PaidByCard } from './paid-by-card'
import { PaidForCard } from './paid-for-card'
import { buildSubmitValues } from './submit-values'
import { useExpenseCurrencyConversion } from './use-expense-currency-conversion'
import { useExpenseFormBalancing } from './use-expense-form-balancing'

export function ExpenseForm(props: {
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  expense?: AppRouterOutput['groups']['expenses']['get']['expense']
  isCopy?: boolean
  searchParams?: CreateExpenseSearch
  heading?: string
  onSubmit: (value: Expense) => Promise<void>
  onDelete?: () => Promise<void>
  runtimeFeatureFlags: RuntimeFeatureFlags
  currentLedgerParticipantId?: string | null
  readOnly?: boolean
  /** Link-invite token for pending invitees (currency recommendations). */
  linkInviteToken?: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
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
    }),
  })

  const groupCurrency = getCurrencyFromGroup(props.group)
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

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        noValidate
        className="-mx-4 min-w-0 w-[calc(100%+2rem)] overflow-x-hidden pb-24 sm:mx-0 sm:w-auto sm:pb-20"
      >
        {props.readOnly && <ReadOnlyNotice />}
        <BasicDetailsCard
          form={form}
          group={props.group}
          readOnly={!!props.readOnly}
          sExpense={sExpense}
          isCreate={isCreate}
          linkInviteToken={props.linkInviteToken}
          extractCategoryMutation={trpc.ai.extractCategoryFromTitle.useMutation()}
          runtimeFeatureFlags={props.runtimeFeatureFlags}
          receiptDocuments={form.getValues('documents')}
          receiptScanContext={receiptScanContext}
          onReceiptAccepted={applyReceiptResult}
          heading={props.heading}
          {...conversion}
          groupCurrency={groupCurrency}
        />
        <ExpenseItemsCard
          form={form}
          group={props.group}
          groupCurrency={payerCurrency}
          readOnly={!!props.readOnly}
          renderItemParticipantsModal={({
            itemIndex,
            item,
            open,
            onClose,
            onSaveItem,
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
        <FormActions
          isCreate={isCreate}
          readOnly={!!props.readOnly}
          onDelete={props.onDelete}
          cancelHref={`/groups/${props.group.id}`}
        />
      </form>
    </Form>
  )
}

function ReadOnlyNotice() {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  return (
    <p className="text-sm text-muted-foreground mb-4">{t('readOnlyNotice')}</p>
  )
}
