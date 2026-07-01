import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn, formatCurrency } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
} from '@spliit/domain'
import { Plus, UserPen } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { FieldPath, UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ExpenseItemRow, expenseItemGridClass } from './expense-item-row'
import {
  isFillerItem,
  type ExpenseFormDisplayItem,
  withAutoOtherFiller,
} from './use-auto-other-filler'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
type EditingTarget = { kind: 'item'; index: number } | { kind: 'filler' }

function makeDefaultItem(group: Group): ExpenseFormItemValues {
  return {
    id: crypto.randomUUID(),
    title: '',
    unitPrice: 0,
    quantity: 1,
    paidFor: group.participants.map((p) => ({
      participant: p.id,
      shares: 1,
    })),
    splitMode: 'EVENLY',
  }
}

export function ExpenseItemsCard({
  form,
  group,
  groupCurrency,
  readOnly,
  renderItemParticipantsModal,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: Group
  groupCurrency: Currency
  readOnly?: boolean
  renderItemParticipantsModal?: (props: {
    itemIndex: number
    item: ExpenseFormItemValues
    open: boolean
    onClose: () => void
    onSaveItem?: (item: ExpenseFormItemValues) => void
  }) => ReactNode
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

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
  const exceedsAmount = itemsSumMajor > amountMajor + 0.01
  const fillerItem = itemsWithFiller.find(isFillerItem)

  const handleAddItem = () => {
    const currentItems = form.getValues('items') ?? []
    form.setValue('items', [...currentItems, makeDefaultItem(group)], {
      shouldDirty: true,
    })
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

  const beginEditing = (target: EditingTarget) => {
    if (splitMode !== 'ITEMIZED') {
      setPendingItemizedEdit(target)
      return
    }
    setEditingTarget(target)
  }

  const openEditDialog = (target: EditingTarget) => {
    if (target.kind === 'filler') {
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

  return (
    <>
      <Card className={cn('mt-4', exceedsAmount && 'border-destructive')}>
        <CardHeader>
          <CardTitle>{t('items.title')}</CardTitle>
          <CardDescription>{t('items.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t('items.empty')}
            </p>
          ) : (
            <div>
              <div
                className={cn(
                  'hidden border-t py-2 text-[11px] font-medium uppercase text-muted-foreground md:grid md:gap-x-3',
                  expenseItemGridClass,
                )}
              >
                <span>{t('items.columnItem')}</span>
                <span className="text-right">{t('items.columnCost')}</span>
                <span className="text-right">{t('items.columnQuantity')}</span>
                <span className="text-right">{t('items.columnTotal')}</span>
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
                      openEditDialog({ kind: 'item', index: displayIndex })
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
                      'en-US',
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

          <div className="border-t pt-3 mt-2">
            <div className="flex justify-between text-sm font-medium">
              <span>{t('items.total')}</span>
              <span>
                {formatCurrency(
                  groupCurrency,
                  itemsWithFiller.reduce(
                    (s, item) =>
                      s + Number(item.unitPrice) * Number(item.quantity),
                    0,
                  ),
                  'en-US',
                  true,
                )}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {editingTarget?.kind === 'item' &&
        renderItemParticipantsModal?.({
          itemIndex: editingTarget.index,
          item: (form.getValues('items') ?? [])[editingTarget.index],
          open: true,
          onClose: closeEditDialog,
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
        })}
      <Dialog
        open={!!pendingItemizedEdit}
        onOpenChange={(open) => {
          if (!open) setPendingItemizedEdit(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('items.switchToItemizedTitle')}</DialogTitle>
            <DialogDescription>
              {t('items.switchToItemizedDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingItemizedEdit(null)}
            >
              {t('cancel')}
            </Button>
            <Button onClick={confirmItemizedEdit}>
              {t('items.switchToItemizedConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SummarizeParticipants({
  item,
  group,
}: {
  item: ExpenseFormItemValues
  group: Group
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const labelKeys = {
    EVENLY: 'items.splitEvenlyLabel',
    BY_SHARES: 'items.splitBySharesLabel',
    BY_PERCENTAGE: 'items.splitByPercentageLabel',
    BY_AMOUNT: 'items.splitByAmountLabel',
  } as const
  const participantNameMap = new Map(
    group.participants.map((p) => [p.id, p.name]),
  )
  const names = item.paidFor
    .map((pf) => participantNameMap.get(pf.participant))
    .filter(Boolean)
    .join(', ')

  return names
    ? `${t(labelKeys[item.splitMode])}: ${names}`
    : t('items.noMembers')
}
