import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Coins,
  Hash,
  Percent,
  Plus,
  UserPen,
  Users,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { FieldPath, UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { FormField, FormItem, FormMessage } from '@/components/ui/form'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { useLocale } from '@/i18n/react'
import { cn, formatCurrency } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { amountAsMinorUnits, itemsExceedExpenseAmount } from '@spliit/domain'

import { applySplitToAll, getCommonItemSplit } from './default-item-split'
import type { SavedSplit } from './default-split/split-equal'
import {
  getNeutralDefaultSplit,
  savedDefaultToFormValues,
} from './default-values'
import { ExpenseItemRow, expenseItemGridClass } from './expense-item-row'
import { isFillerItem, withAutoOtherFiller } from './use-auto-other-filler'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
type ItemSplitMode = ExpenseFormItemValues['splitMode']
type EditingTarget =
  | { kind: 'item'; index: number }
  | { kind: 'filler' }
  | { kind: 'default' }

function makeDefaultItem(
  group: Group,
  commonSplit: {
    splitMode: ItemSplitMode
    paidFor: ExpenseFormItemValues['paidFor']
  } | null = null,
): ExpenseFormItemValues {
  const splitMode: ItemSplitMode = commonSplit?.splitMode ?? 'EVENLY'
  const paidFor =
    commonSplit?.paidFor ??
    group.participants.map((p) => ({
      participant: p.id,
      shares: 1,
    }))
  return {
    id: crypto.randomUUID(),
    title: '',
    unitPrice: 0,
    quantity: 1,
    paidFor: paidFor.map((r) => ({ ...r })),
    splitMode,
  }
}

function resolveSeedSplit(
  savedDefault: SavedSplit | null | undefined,
  group: Group,
  groupCurrency: Currency,
): { splitMode: ItemSplitMode; paidFor: ExpenseFormItemValues['paidFor'] } {
  // savedDefaultToFormValues and getNeutralDefaultSplit both reject
  // ITEMIZED at runtime (the persisted-default schema and the neutral
  // default are hardcoded EVENLY); the wider static SplitMode union from
  // DefaultSplittingOptions is safe to narrow here.
  return (savedDefaultToFormValues(savedDefault, group, groupCurrency) ??
    getNeutralDefaultSplit(group)) as {
    splitMode: ItemSplitMode
    paidFor: ExpenseFormItemValues['paidFor']
  }
}

// react-doctor-disable-next-line react-doctor/no-giant-component -- cohesive itemized expense card, shared form state
export function ExpenseItemsCard({
  form,
  group,
  groupCurrency,
  readOnly,
  savedDefault,
  renderItemParticipantsModal,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  groupCurrency: Currency
  readOnly?: boolean
  /**
   * Persisted per-user-per-group default split, used to seed items when
   * switching to itemized and surfaced in the per-item modal as a "Load
   * default" action.
   */
  savedDefault?: SavedSplit | null
  renderItemParticipantsModal?: (props: {
    itemIndex: number
    item: ExpenseFormItemValues
    open: boolean
    onClose: () => void
    onSaveItem?: (item: ExpenseFormItemValues) => void
    titleOverride?: string
    hideAmountDescription?: boolean
    hideAmountMode?: boolean
    savedDefault?: unknown
  }) => ReactNode
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const locale = useLocale()

  const items = useWatch({ control: form.control, name: 'items' }) ?? []
  const amount = useWatch({ control: form.control, name: 'amount' })
  const splitMode = useWatch({ control: form.control, name: 'splitMode' })
  const itemizedRemainder = useWatch({
    control: form.control,
    name: 'itemizedRemainder',
  })
  const amountMajor = Number(amount) || 0

  const itemsWithFiller = withAutoOtherFiller(
    items,
    amountMajor,
    groupCurrency,
    itemizedRemainder,
  )
  const itemsSumMajor = items.reduce(
    (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity),
    0,
  )
  const exceedsAmount = itemsExceedExpenseAmount(
    amountAsMinorUnits(itemsSumMajor, groupCurrency),
    amountAsMinorUnits(amountMajor, groupCurrency),
  )
  const fillerItem = itemsWithFiller.find(isFillerItem)

  const commonSplit = getCommonItemSplit(items)
  const displayedDefaultSplit =
    commonSplit ??
    (items.length === 0
      ? resolveSeedSplit(savedDefault, group, groupCurrency)
      : null)

  const seedItemsAndRemainder = () => {
    const seed = resolveSeedSplit(savedDefault, group, groupCurrency)
    const result = applySplitToAll({
      items: form.getValues('items') ?? [],
      split: seed,
      expenseAmount: Number(form.getValues('amount')) || 0,
      groupCurrency,
    })
    form.setValue('items', result.items, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('itemizedRemainder', result.itemizedRemainder, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
  }

  const handleAddItem = () => {
    const currentItems = form.getValues('items') ?? []
    form.setValue(
      'items',
      [...currentItems, makeDefaultItem(group, commonSplit)],
      {
        shouldDirty: true,
      },
    )
    window.setTimeout(() => {
      form.setFocus(
        `items.${currentItems.length}.title` as FieldPath<ExpenseFormInputValues>,
      )
    }, 0)
  }

  const handleDeleteItem = (index: number) => {
    const currentItems = form.getValues('items') ?? []
    form.setValue(
      'items',
      currentItems.filter((_, i) => i !== index),
      { shouldDirty: true },
    )
  }

  const handleSetExpenseAmount = () => {
    form.setValue('amount', itemsSumMajor, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
  }

  const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null)
  const [pendingItemizedEdit, setPendingItemizedEdit] =
    useState<EditingTarget | null>(null)
  const [itemsOpen, setItemsOpen] = useState(
    () => splitMode === 'ITEMIZED' || items.length > 0,
  )

  useEffect(() => {
    if (splitMode === 'ITEMIZED' || items.length > 0) {
      // oxlint-disable-next-line react/react-compiler -- open the item editor when controlled items become available.
      setItemsOpen(true)
    }
  }, [items.length, splitMode])

  const beginEditing = (target: EditingTarget) => {
    if (splitMode !== 'ITEMIZED') {
      setPendingItemizedEdit(target)
      return
    }
    setEditingTarget(target)
  }

  const openEditDialog = (target: EditingTarget) => {
    if (target.kind === 'filler' || target.kind === 'default') {
      beginEditing(target)
      return
    }
    const currentItems = form.getValues('items') ?? []
    if (currentItems[target.index]) beginEditing(target)
  }

  const confirmItemizedEdit = () => {
    if (!pendingItemizedEdit) return
    form.setValue('splitMode', 'ITEMIZED', {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    seedItemsAndRemainder()
    setEditingTarget(pendingItemizedEdit)
    setPendingItemizedEdit(null)
  }

  const closeEditDialog = () => {
    setEditingTarget(null)
  }

  const handleSaveFiller = (item: ExpenseFormItemValues) => {
    form.setValue(
      'itemizedRemainder',
      {
        paidFor: item.paidFor,
        splitMode: item.splitMode,
      },
      {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      },
    )
  }

  const handleSaveDefault = (item: ExpenseFormItemValues) => {
    const result = applySplitToAll({
      items: form.getValues('items') ?? [],
      split: { splitMode: item.splitMode, paidFor: item.paidFor },
      expenseAmount: Number(form.getValues('amount')) || 0,
      groupCurrency,
    })
    form.setValue('items', result.items, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
    form.setValue('itemizedRemainder', result.itemizedRemainder, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    })
  }

  const defaultSplitDraft = (): ExpenseFormItemValues => {
    const base =
      commonSplit ?? resolveSeedSplit(savedDefault, group, groupCurrency)
    return {
      id: 'default-items-split',
      title: t('items.defaultSplitModalTitle'),
      unitPrice: Number(form.getValues('amount')) || 0,
      quantity: 1,
      paidFor: base.paidFor.map((r) => ({ ...r })),
      splitMode: base.splitMode,
    }
  }

  return (
    <>
      <Card
        className={cn(
          'mobile-surface mt-4',
          exceedsAmount && 'border-destructive',
        )}
      >
        <Collapsible open={itemsOpen} onOpenChange={setItemsOpen}>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle>{t('items.title')}</CardTitle>
              <CardDescription>{t('items.description')}</CardDescription>
            </div>
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground"
                />
              }
            >
              {itemsOpen ? t('items.hideItems') : t('items.showItems')}
              {itemsOpen ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <FormField
                control={form.control}
                name="items"
                render={() => (
                  <FormItem className="space-y-0">
                    <DefaultSplitAction
                      splitMode={displayedDefaultSplit?.splitMode ?? 'EVENLY'}
                      label={t('items.defaultSplitLabel')}
                      summary={
                        displayedDefaultSplit ? (
                          <SummarizeParticipants
                            item={{
                              splitMode: displayedDefaultSplit.splitMode,
                              paidFor: displayedDefaultSplit.paidFor,
                            }}
                            group={group}
                          />
                        ) : (
                          t('items.defaultSplitMixed')
                        )
                      }
                      editLabel={t('items.defaultSplitEdit')}
                      readOnly={readOnly}
                      onClick={() => openEditDialog({ kind: 'default' })}
                    />

                    {items.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {t('items.empty')}
                      </p>
                    ) : (
                      <div>
                        <div
                          className={cn(
                            'mt-5 hidden border-t py-2 text-[11px] font-medium text-muted-foreground uppercase md:grid md:gap-x-3',
                            expenseItemGridClass,
                          )}
                        >
                          <span>{t('items.columnItem')}</span>
                          <span className="text-end">
                            {t('items.columnCost')}
                          </span>
                          <span className="text-end">
                            {t('items.columnQuantity')}
                          </span>
                          <span className="text-end">
                            {t('items.columnTotal')}
                          </span>
                          <span />
                        </div>
                        {items.map((item, displayIndex) => {
                          return (
                            <ExpenseItemRow
                              key={item.id ?? displayIndex}
                              form={form}
                              item={item}
                              itemIndex={displayIndex}
                              readOnly={readOnly}
                              group={group}
                              groupCurrency={groupCurrency}
                              onEdit={() => {
                                openEditDialog({
                                  kind: 'item',
                                  index: displayIndex,
                                })
                              }}
                              onDelete={() => {
                                handleDeleteItem(displayIndex)
                              }}
                            />
                          )
                        })}
                      </div>
                    )}

                    {!readOnly && (
                      <div className="mt-4 flex justify-center">
                        <Button
                          variant="outline"
                          size="default"
                          type="button"
                          onClick={handleAddItem}
                          className="min-w-48 gap-2 px-8"
                        >
                          <Plus className="h-4 w-4" />
                          {t('items.addItem')}
                        </Button>
                      </div>
                    )}

                    {fillerItem && (
                      <div className="mt-4 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-medium">
                              {t('items.other')}
                            </span>
                            <span className="text-sm font-medium tabular-nums">
                              {formatCurrency(
                                groupCurrency,
                                Number(fillerItem.unitPrice) *
                                  Number(fillerItem.quantity),
                                locale,
                                true,
                              )}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            <SummarizeParticipants
                              item={fillerItem}
                              group={group}
                            />
                          </p>
                        </div>
                        {!readOnly && (
                          <Button
                            variant="ghost"
                            size="icon"
                            type="button"
                            onClick={() => openEditDialog({ kind: 'filler' })}
                            aria-label={t('items.modalTitle')}
                            title={t('items.modalTitle')}
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <UserPen className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}

                    {exceedsAmount && (
                      <div className="mt-3 flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
                        <span>{t('items.errorExceedsAmount')}</span>
                        {!readOnly && (
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={handleSetExpenseAmount}
                            className="shrink-0 border-destructive/40 text-destructive hover:text-destructive"
                          >
                            {t('items.setExpenseAmount')}
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="mt-2 border-t pt-3">
                      <div className="flex justify-between text-sm font-medium">
                        <span>{t('items.total')}</span>
                        <span>
                          {formatCurrency(
                            groupCurrency,
                            itemsWithFiller.reduce(
                              (s, item) =>
                                s +
                                Number(item.unitPrice) * Number(item.quantity),
                              0,
                            ),
                            locale,
                            true,
                          )}
                        </span>
                      </div>
                      <FormMessage className="mt-2" />
                    </div>
                  </FormItem>
                )}
              />
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {editingTarget?.kind === 'item' &&
        renderItemParticipantsModal?.({
          itemIndex: editingTarget.index,
          item: (form.getValues('items') ?? [])[editingTarget.index],
          open: true,
          onClose: closeEditDialog,
          savedDefault,
        })}
      {editingTarget?.kind === 'filler' &&
        fillerItem &&
        renderItemParticipantsModal?.({
          itemIndex: -1,
          item: {
            ...fillerItem,
            title: t('items.other'),
            paidFor: fillerItem.paidFor.length
              ? fillerItem.paidFor
              : group.participants.map((participant) => ({
                  participant: participant.id,
                  shares: 1,
                })),
          },
          open: true,
          onClose: closeEditDialog,
          onSaveItem: handleSaveFiller,
          savedDefault,
        })}
      {editingTarget?.kind === 'default' &&
        renderItemParticipantsModal?.({
          itemIndex: -1,
          item: defaultSplitDraft(),
          open: true,
          onClose: closeEditDialog,
          onSaveItem: handleSaveDefault,
          titleOverride: t('items.defaultSplitModalTitle'),
          hideAmountDescription: true,
          hideAmountMode: true,
          savedDefault,
        })}
      <ResponsiveDialog
        open={!!pendingItemizedEdit}
        onOpenChange={(open) => {
          if (!open) setPendingItemizedEdit(null)
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t('items.switchToItemizedTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('items.switchToItemizedDescription')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingItemizedEdit(null)}
            >
              {t('cancel')}
            </Button>
            <Button onClick={confirmItemizedEdit}>
              {t('items.switchToItemizedConfirm')}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}

const defaultSplitIcons = {
  EVENLY: Users,
  BY_SHARES: Hash,
  BY_PERCENTAGE: Percent,
  BY_AMOUNT: Coins,
} as const

function DefaultSplitAction({
  splitMode,
  label,
  summary,
  editLabel,
  readOnly,
  onClick,
}: {
  splitMode: ItemSplitMode
  label: string
  summary: ReactNode
  editLabel: string
  readOnly?: boolean
  onClick: () => void
}) {
  const Icon = defaultSplitIcons[splitMode]
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-colors',
          readOnly
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary/10 text-primary group-hover:bg-primary/15',
        )}
      >
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-snug text-muted-foreground sm:text-sm">
          {summary}
        </span>
      </span>
      {!readOnly && (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-sm">
          <span className="hidden sm:inline">{editLabel}</span>
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </span>
      )}
    </>
  )

  if (readOnly) {
    return (
      <div className="flex items-center gap-3 border-y py-3">{content}</div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={editLabel}
      className="group flex w-full items-center gap-3 border-y py-3 text-start transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden"
    >
      {content}
    </button>
  )
}

const labelKeys = {
  EVENLY: 'items.splitEvenlyLabel',
  BY_SHARES: 'items.splitBySharesLabel',
  BY_PERCENTAGE: 'items.splitByPercentageLabel',
  BY_AMOUNT: 'items.splitByAmountLabel',
} as const

function SummarizeParticipants({
  item,
  group,
}: {
  item: Pick<ExpenseFormItemValues, 'splitMode' | 'paidFor'>
  group: Group
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const participantNameMap = new Map(
    group.participants.map((p) => [p.id, p.name]),
  )
  const names = item.paidFor
    .flatMap((pf) => {
      const name = participantNameMap.get(pf.participant)
      return name ? [name] : []
    })
    .join(', ')

  return names
    ? `${t(labelKeys[item.splitMode])}: ${names}`
    : t('items.noMembers')
}
