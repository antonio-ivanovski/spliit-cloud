import { useWatch, type UseFormReturn } from 'react-hook-form'
import { Trans, useTranslation } from 'react-i18next'

import { ParticipantSelector } from '@/components/participant-selector'
import type { ExpenseFormInputValues } from '@/lib/schemas'
import type { AppRouterOutput } from '@spliit/api/router'
import { isSettlementCategory } from '@spliit/domain'

import { expenseTabPriority } from './focus-navigation'
import { useFormSections } from './form-sections'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
const modeKeys = {
  EVENLY: 'simplified.evenly',
  BY_SHARES: 'simplified.byShares',
  BY_PERCENTAGE: 'simplified.byPercentage',
  BY_AMOUNT: 'simplified.byAmount',
  ITEMIZED: 'simplified.byItems',
} as const

export function SplitSummary({
  form,
  group,
  currentParticipantId,
  readOnly,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  currentParticipantId?: string | null
  readOnly: boolean
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const sections = useFormSections()!
  const [paidByList, isMultiPayer, splitMode, paidFor, amount, category] =
    useWatch({
      control: form.control,
      name: [
        'paidByList',
        'isMultiPayer',
        'splitMode',
        'paidFor',
        'amount',
        'category',
      ],
    })
  const income = Number(amount) < 0
  const payer = paidByList?.[0]?.participant
  const payerName =
    payer && payer === currentParticipantId
      ? t('simplified.you')
      : (group.participants.find((p) => p.id === payer)?.name ??
        t('Expense.paidByField.placeholder'))
  const payerLabel = isMultiPayer
    ? t('simplified.selectedPeople', {
        selected: paidByList.length,
        total: group.participants.length,
      })
    : payerName
  const openSplit = (priority: number) => {
    sections.setOpen('split', true)
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `#expense-split-editors [data-expense-tab-priority="${priority}"][aria-checked="true"]`,
        )
        ?.focus(),
    )
  }
  const tokenClass =
    'rounded-md px-1 py-1 font-semibold text-primary underline decoration-primary/25 underline-offset-4 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
  const token = (label: string, priority: number) =>
    readOnly ? (
      <strong>{label}</strong>
    ) : (
      <button
        type="button"
        onClick={() => openSplit(priority)}
        className={tokenClass}
        data-expense-tab-priority={priority}
      >
        {label}
      </button>
    )
  const payerToken =
    !readOnly && !isMultiPayer ? (
      <ParticipantSelector
        participants={group.participants}
        mode="single"
        defaultValue={payer}
        singlePlaceholder={payerName}
        selectedLabel={payerName}
        focusPriority={expenseTabPriority.paidBy}
        mobileTitle={t(`${income ? 'Income' : 'Expense'}.paidByField.label`)}
        triggerClassName="inline-flex h-auto min-h-9 max-w-full border-0 bg-primary/5 px-2 text-primary shadow-none"
        onValueChange={(participant) =>
          form.setValue(
            'paidByList',
            [{ participant, shares: Number(amount) || 0 }],
            { shouldDirty: true, shouldTouch: true, shouldValidate: true },
          )
        }
      />
    ) : (
      token(payerLabel, expenseTabPriority.paidBy)
    )
  const settlement =
    isSettlementCategory(category) &&
    !isMultiPayer &&
    paidByList?.length === 1 &&
    paidFor?.length === 1
  if (settlement) {
    const recipient = paidFor[0]!
    return (
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        <Trans
          i18nKey="ExpenseForm.simplified.settlement"
          values={{
            from: payerName,
            to:
              group.participants.find((p) => p.id === recipient.participant)
                ?.name ?? '',
          }}
          components={{
            from: payerToken,
            to: readOnly ? (
              <strong />
            ) : (
              <ParticipantSelector
                participants={group.participants}
                mode="single"
                defaultValue={recipient.participant}
                mobileTitle={t('Expense.paidFor.title')}
                onValueChange={(participant) =>
                  form.setValue('paidFor', [{ ...recipient, participant }], {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  })
                }
              />
            ),
          }}
        />
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <Trans
        i18nKey={`ExpenseForm.simplified.${income ? 'receivedBy' : 'paidBy'}`}
        values={{ name: payerLabel }}
        components={{ payer: payerToken }}
      />
      <span className="text-muted-foreground" aria-hidden="true">
        ·
      </span>
      <Trans
        i18nKey={`ExpenseForm.simplified.${income ? 'allocation' : 'split'}`}
        values={{
          mode: t(modeKeys[splitMode]),
          people:
            paidFor.length === group.participants.length
              ? t('simplified.everyone')
              : t('simplified.selectedPeople', {
                  selected: paidFor.length,
                  total: group.participants.length,
                }),
        }}
        components={{
          mode: token(t(modeKeys[splitMode]), expenseTabPriority.paidFor),
          people: token('', expenseTabPriority.paidFor),
        }}
      />
    </div>
  )
}
