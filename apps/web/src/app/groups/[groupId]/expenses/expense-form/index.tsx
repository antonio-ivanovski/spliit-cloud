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
import type { Currency } from '@spliit/domain'
import { useState } from 'react'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { BasicDetailsCard } from './basic-details-card'
import {
  buildExpenseFormDefaults,
  persistDefaultSplittingOptions,
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

export function ExpenseForm(props: {
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  expense?: AppRouterOutput['groups']['expenses']['get']['expense']
  searchParams?: CreateExpenseSearch
  onSubmit: (value: Expense) => Promise<void>
  onDelete?: () => Promise<void>
  runtimeFeatureFlags: RuntimeFeatureFlags
  currentLedgerParticipantId?: string | null
  readOnly?: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const form = useForm<ExpenseFormInputValues>({
    resolver: zodResolver(expenseFormInputSchema) as Resolver<ExpenseFormInputValues>,
    defaultValues: buildExpenseFormDefaults({
      isCreate: props.expense === undefined,
      expense: props.expense,
      searchParams: props.searchParams ?? {},
      group: props.group,
      groupCurrency: getCurrencyFromGroup(props.group),
      currentLedgerParticipantId: props.currentLedgerParticipantId,
      reimbursementTitle: t('reimbursement'),
    }),
  })

  const [isIncome, setIsIncome] = useState(Number(form.getValues().amount) < 0)
  const isCreate = props.expense === undefined

  const groupCurrency = getCurrencyFromGroup(props.group)
  const conversion = useExpenseCurrencyConversion({
    form,
    group: props.group,
    groupCurrency,
    t,
    onAmountChanged: (income) => {
      setIsIncome(income)
      if (income) form.setValue('isReimbursement', false)
    },
  })

  const originalCurrencyValue = useWatch({
    control: form.control,
    name: 'originalCurrency',
  })
  const payerCurrency: Currency = originalCurrencyValue
    ? (getCurrency(originalCurrencyValue) ?? groupCurrency)
    : groupCurrency

  const { setManuallyEditedParticipants, setManuallyEditedPayers } =
    useExpenseFormBalancing({ form, groupCurrency, payerCurrency })

  const sExpense = (isIncome ? 'Income' : 'Expense') as 'Expense' | 'Income'

  const submit = async (values: ExpenseFormInputValues) => {
    if (props.readOnly) return
    await persistDefaultSplittingOptions(props.group.id, form.getValues())
    return props.onSubmit(
      buildSubmitValues(values, {
        groupCurrency,
        conversionRequired: conversion.conversionRequired,
      }),
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} noValidate>
        {props.readOnly && <ReadOnlyNotice />}
        <BasicDetailsCard
          form={form}
          group={props.group}
          groupCurrency={groupCurrency}
          readOnly={!!props.readOnly}
          sExpense={sExpense}
          isIncome={isIncome}
          setIsIncome={setIsIncome}
          isCreate={isCreate}
          extractCategoryMutation={trpc.ai.extractCategoryFromTitle.useMutation()}
          runtimeFeatureFlags={props.runtimeFeatureFlags}
          {...conversion}
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
        <PaidByCard
          form={form}
          group={props.group}
          groupCurrency={groupCurrency}
          payerCurrency={payerCurrency}
          readOnly={!!props.readOnly}
          sExpense={sExpense}
          setManuallyEditedPayers={setManuallyEditedPayers}
        />
        <PaidForCard
          form={form}
          group={props.group}
          groupCurrency={groupCurrency}
          payerCurrency={payerCurrency}
          readOnly={!!props.readOnly}
          sExpense={sExpense}
          setManuallyEditedParticipants={setManuallyEditedParticipants}
        />
        {props.runtimeFeatureFlags.enableExpenseDocuments && (
          <DocumentsCard
            form={form}
            group={props.group}
            readOnly={!!props.readOnly}
            sExpense={sExpense}
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
