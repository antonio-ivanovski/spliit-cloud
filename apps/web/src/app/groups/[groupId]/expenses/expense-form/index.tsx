import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import {
  useForm,
  useFormState,
  useWatch,
  type FieldErrors,
  type FieldPath,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { Button } from '@/components/ui/button'
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
import type { ShareArrayName, ShareInputKey } from './share-row-input'
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
  if (itemMatch) return `items.${itemMatch[1] ?? 0}.title`
  return path
}

/**
 * Resolve a share error path (`paidFor`, `paidFor.root`, `paidFor.2.shares`, …)
 * to the owning array and participant of the first affected row, or `null` when
 * the error cannot be mapped to a row (e.g. an empty `paidFor` list). Focus
 * then targets the section-qualified input registry instead of an array index,
 * which is unstable while rows are being added/removed — and instead of a bare
 * participant id, which is ambiguous because the same participant has inputs in
 * both `paidFor` and `paidByList`.
 */
function shareErrorTarget(
  path: string,
  form: UseFormReturn<ExpenseFormInputValues>,
): { arrayName: ShareArrayName; participantId: string } | null {
  const paidForMatch = path.match(/^paidFor(?:\.(\d+))?/)
  if (paidForMatch) {
    const rows = form.getValues('paidFor')
    const participantId = rows[Number(paidForMatch[1] ?? 0)]?.participant
    return participantId ? { arrayName: 'paidFor', participantId } : null
  }
  const paidByMatch = path.match(/^paidByList(?:\.(\d+))?/)
  if (paidByMatch) {
    const rows = form.getValues('paidByList')
    const participantId = rows[Number(paidByMatch[1] ?? 0)]?.participant
    return participantId ? { arrayName: 'paidByList', participantId } : null
  }
  return null
}

/**
 * Outcome of an `ExpenseForm` submit:
 *
 * - `'saved'` — the expense was persisted; post-save work (`onSaved`) may run.
 * - `'deferred'` — the flow suspended the save (e.g. a recurring-edit scope
 *   dialog will perform it later); no post-save work should run.
 */
export type ExpenseSubmitOutcome = 'saved' | 'deferred'

export function ExpenseForm(props: {
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  expense?: AppRouterOutput['groups']['expenses']['get']['expense']
  isCopy?: boolean
  searchParams?: CreateExpenseSearch
  heading?: string
  /** Internal path to return to when the form was opened from another feed. */
  cancelHref?: string
  /**
   * Persistence callback. Resolves `'saved'` once the expense is persisted and
   * `'deferred'` when the flow only suspends the save (see
   * {@link ExpenseSubmitOutcome}). A rejection is a persistence failure: nothing
   * was saved, the mutation hooks already surface it through their error toast,
   * and a manual retry is safe — the form stays enabled.
   */
  onSubmit: (value: Expense) => Promise<ExpenseSubmitOutcome>
  /**
   * Optional post-save work (typically navigation), awaited only after a
   * `'saved'` outcome. A rejection here is NOT a persistence failure — the
   * expense already exists — so the form surfaces a dedicated notice with a
   * leave-again action instead of reporting a save failure (which would invite
   * a duplicate retry). After a `'saved'` outcome the form is terminal: the
   * submit action is disabled and only this callback may run.
   */
  onSaved?: () => Promise<void>
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
  // Set when `onSubmit` resolved 'saved' but `onSaved` (post-save work such
  // as navigation) failed: the expense already exists, so this must not be
  // reported as a save failure (that would invite a duplicate retry).
  const [postSaveFailure, setPostSaveFailure] = useState(false)
  // True once persistence succeeded. 'saved' is a terminal outcome: the
  // expense exists, so the submit action is disabled (a retry would
  // duplicate it) and the only escape is the leave-again action, which
  // invokes `onSaved` without re-persisting.
  const [persisted, setPersisted] = useState(false)
  const [retryingNav, setRetryingNav] = useState(false)
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
    // Focus choreography is handled by `handleInvalidSubmit` below, which
    // maps array/items roots onto real inputs; the default walker cannot
    // reach the nested share fields and would fight the explicit setFocus.
    shouldFocusError: false,
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

  // Section-qualified registry (`paidFor:lp-1` / `paidByList:lp-1`) of the
  // paid-for / paid-by share inputs. Focus for share errors goes through it —
  // the participant id alone would be ambiguous across the two sections.
  const shareInputRefs = useRef(new Map<ShareInputKey, HTMLInputElement>())

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
  // Narrowed watches: only the fields the receipt-scan context consumes
  // (a whole-form useWatch re-renders the entire form on every keystroke).
  const watchedTitle = useWatch({ control: form.control, name: 'title' })
  const watchedAmount = useWatch({ control: form.control, name: 'amount' })
  const watchedExpenseDate = useWatch({
    control: form.control,
    name: 'expenseDate',
  })
  const watchedCategory = useWatch({ control: form.control, name: 'category' })
  const watchedItems = useWatch({ control: form.control, name: 'items' })
  const payerCurrency: Currency = originalCurrencyValue
    ? (getCurrency(originalCurrencyValue) ?? groupCurrency)
    : groupCurrency

  const { setManuallyEditedParticipants, setManuallyEditedPayers } =
    useExpenseFormBalancing({ form, payerCurrency })

  const sExpense = (isIncome ? 'Income' : 'Expense') as 'Expense' | 'Income'

  const receiptScanContext: ReceiptScanContext = {
    title: watchedTitle || undefined,
    amount: Number(watchedAmount) || undefined,
    date: watchedExpenseDate?.toISOString().slice(0, 10),
    currencyCode: originalCurrencyValue || groupCurrency.code,
    categoryId: watchedCategory || undefined,
    items: (watchedItems ?? []).map((item) => ({
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
    if (props.readOnly || persisted) return
    setPostSaveFailure(false)
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
    let outcome: ExpenseSubmitOutcome | null = null
    try {
      outcome = await props.onSubmit(
        buildSubmitValues(values, {
          groupCurrency,
          conversionRequired: conversion.conversionRequired,
        }),
      )
    } catch {
      // Persistence failure: nothing was saved, the mutation hooks already
      // surfaced it through their error toast, and a manual retry is safe —
      // so the form stays enabled and no inline error is claimed.
    }
    if (outcome !== 'saved') return
    // The expense exists now; persistence is terminal (see `persisted`).
    setPersisted(true)
    if (!props.onSaved) return
    try {
      await props.onSaved()
    } catch {
      // Post-save work failed (e.g. navigation) AFTER the expense was
      // persisted. Resubmitting would duplicate the expense, so surface a
      // dedicated notice with a leave-again action instead of a
      // save-failure message.
      setPostSaveFailure(true)
    }
  }

  // Retries only the post-save work: persistence already happened and must
  // not run again.
  const tryLeavingAgain = async () => {
    if (!props.onSaved || retryingNav) return
    setRetryingNav(true)
    try {
      await props.onSaved()
      setPostSaveFailure(false)
    } catch {
      setPostSaveFailure(true)
    } finally {
      setRetryingNav(false)
    }
  }

  const handleInvalidSubmit = (errors: FieldErrors<ExpenseFormInputValues>) => {
    const path = firstErrorPath(errors)
    if (!path) return
    // Share errors focus through the section-qualified input registry;
    // everything else falls back to RHF's setFocus.
    const target = shareErrorTarget(path, form)
    if (target) {
      const shareInput = shareInputRefs.current.get(
        `${target.arrayName}:${target.participantId}`,
      )
      if (shareInput) {
        shareInput.focus()
        return
      }
    }
    // Some valid form states (for example single-payer paid-by mode) have a
    // share error path but intentionally render no share input. Do not stop
    // after a missing registry entry; retain RHF's normal fallback behavior.
    form.setFocus(focusableErrorPath(path) as FieldPath<ExpenseFormInputValues>)
  }

  return (
    <Form {...form}>
      <form
        // oxlint-disable-next-line react/react-compiler -- handleInvalidSubmit reads shareInputRefs at submit time (event handler, never during render); the section-qualified registry replaces array-index focus for position-shifting rows.
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
          inputRefs={shareInputRefs}
        />
        <PaidByCard
          form={form}
          group={props.group}
          groupCurrency={groupCurrency}
          payerCurrency={payerCurrency}
          readOnly={!!props.readOnly}
          sExpense={sExpense}
          setManuallyEditedPayers={setManuallyEditedPayers}
          inputRefs={shareInputRefs}
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
        <ValidationSummary form={form} />
        {postSaveFailure && props.onSaved && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <p>{t('savedButNotNavigated')}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={retryingNav}
              onClick={() => void tryLeavingAgain()}
            >
              {t('tryLeavingAgain')}
            </Button>
          </div>
        )}
        <FormActions
          isCreate={isCreate}
          readOnly={!!props.readOnly}
          onDelete={props.onDelete}
          cancelHref={props.cancelHref ?? `/groups/${props.group.id}`}
          submitDisabled={persisted}
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

/**
 * Inline "correct the highlighted fields" summary, derived from RHF's own state
 * through an isolated `useFormState` subscription instead of a local flag: a
 * mirrored `hasValidationError` state could only be cleared by another submit,
 * so the banner would keep claiming errors after every field was fixed. RHF
 * revalidates errored fields on change once a submit happened, so this clears
 * as soon as `errors` empties.
 */
function ValidationSummary({
  form,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { isSubmitted, errors } = useFormState({ control: form.control })
  if (!isSubmitted || Object.keys(errors).length === 0) return null
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <p>{t('validationSummary')}</p>
    </div>
  )
}
