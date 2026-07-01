import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormItem } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { cn, formatCurrency } from '@/lib/utils'
import type { AppRouterOutput } from '@spliit/api/router'
import type {
  Currency,
  ExpenseFormInputValues,
  ExpenseFormItemValues,
  SplitMode,
} from '@spliit/domain'
import { Hash, Trash2, UserPen } from 'lucide-react'
import type { FieldPath, UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { AmountInput } from './amount-input'
import { enforceCurrencyPattern, enforceIntegerPattern } from './currency-utils'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
type ItemSplitMode = Exclude<SplitMode, 'ITEMIZED'>
export const expenseItemGridClass =
  'md:grid-cols-[minmax(180px,1fr)_104px_82px_92px_64px]'

function itemPath<K extends keyof ExpenseFormItemValues>(
  index: number,
  key: K,
): FieldPath<ExpenseFormInputValues> {
  return `items.${index}.${String(key)}` as FieldPath<ExpenseFormInputValues>
}

const splitModeLabelKeys = {
  EVENLY: 'items.splitEvenlyLabel',
  BY_SHARES: 'items.splitBySharesLabel',
  BY_PERCENTAGE: 'items.splitByPercentageLabel',
  BY_AMOUNT: 'items.splitByAmountLabel',
} as const

export function ExpenseItemRow({
  form,
  itemIndex,
  item,
  isFiller,
  readOnly,
  group,
  groupCurrency,
  onEdit,
  onDelete,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
  itemIndex: number
  item: ExpenseFormItemValues
  isFiller?: boolean
  readOnly?: boolean
  group: Group
  groupCurrency: Currency
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { control } = form
  const watchedTitle = useWatch({
    control,
    name: itemPath(itemIndex, 'title'),
  }) as string | undefined
  const watchedUnitPrice = useWatch({
    control,
    name: itemPath(itemIndex, 'unitPrice'),
  }) as number | undefined
  const watchedQuantity = useWatch({
    control,
    name: itemPath(itemIndex, 'quantity'),
  }) as number | undefined
  const watchedPaidFor = useWatch({
    control,
    name: itemPath(itemIndex, 'paidFor'),
  }) as ExpenseFormItemValues['paidFor'] | undefined

  const title = isFiller ? item.title : watchedTitle
  const unitPrice = isFiller ? item.unitPrice : watchedUnitPrice
  const quantity = isFiller ? item.quantity : watchedQuantity
  const paidFor = isFiller ? item.paidFor : watchedPaidFor
  const splitMode = (
    isFiller ? item.splitMode : item.splitMode
  ) as ItemSplitMode
  const total = Number(unitPrice) * Number(quantity)
  const participantNameMap = new Map(
    group.participants.map((p) => [p.id, p.name]),
  )
  const participantNames =
    paidFor
      ?.map((pf: { participant: string }) =>
        participantNameMap.get(pf.participant),
      )
      .filter(Boolean)
      .join(', ') ?? ''
  const participantsLabel = participantNames
    ? `${t(splitModeLabelKeys[splitMode])}: ${participantNames}`
    : t('items.noMembers')

  const priceDisplay = formatCurrency(
    groupCurrency,
    Number(unitPrice),
    'en-US',
    true,
  )
  const totalDisplay = formatCurrency(groupCurrency, total, 'en-US', true)

  const displayOther = t('items.other')
  const displayActionEdit = t('items.modalTitle')
  const displayActionDelete = t('items.actionDelete')
  const displayColumnItem = t('items.columnItem')
  const displayColumnCost = t('items.columnCost')
  const displayColumnQuantity = t('items.columnQuantity')
  const displayColumnTotal = t('items.columnTotal')

  return (
    <div className={cn('border-t py-3', isFiller && 'bg-muted/25')}>
      <div
        className={cn(
          'grid grid-cols-1 gap-2 md:items-start md:gap-x-3',
          expenseItemGridClass,
        )}
      >
        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground md:hidden">
            {displayColumnItem}
          </div>
          {isFiller ? (
            <div className="flex min-h-9 items-center">
              <span className="truncate text-sm font-medium">
                {title || displayOther}
              </span>
            </div>
          ) : (
            <FormField
              control={control}
              name={itemPath(itemIndex, 'title')}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      {...field}
                      id={`expense-item-title-${itemIndex}`}
                      aria-label={displayColumnItem}
                      className="h-9"
                      disabled={readOnly}
                      value={(field.value as string) ?? ''}
                      autoComplete="off"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          )}
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium text-muted-foreground md:hidden">
            {displayColumnCost}
          </div>
          {isFiller ? (
            <div className="flex h-9 items-center justify-start text-sm text-muted-foreground md:justify-end">
              {priceDisplay}
            </div>
          ) : (
            <FormField
              control={control}
              name={itemPath(itemIndex, 'unitPrice')}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <AmountInput
                      currency={groupCurrency}
                      aria-label={displayColumnCost}
                      className="h-9"
                      type="text"
                      disabled={readOnly}
                      value={String(field.value ?? '')}
                      inputMode="decimal"
                      step={10 ** -groupCurrency.decimal_digits}
                      onChange={(event) =>
                        field.onChange(
                          Number(enforceCurrencyPattern(event.target.value)) ||
                            0,
                        )
                      }
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          )}
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium text-muted-foreground md:hidden">
            {displayColumnQuantity}
          </div>
          {isFiller ? (
            <div className="flex h-9 items-center justify-start text-sm text-muted-foreground md:justify-end">
              {Number(quantity)}
            </div>
          ) : (
            <FormField
              control={control}
              name={itemPath(itemIndex, 'quantity')}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="relative">
                      <Hash
                        aria-hidden="true"
                        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                      />
                    <Input
                      aria-label={displayColumnQuantity}
                      className="h-9 pl-7 pr-2 text-right tabular-nums"
                      type="text"
                      disabled={readOnly}
                      value={(field.value as number) ?? ''}
                      inputMode="numeric"
                      step={1}
                      onChange={(event) =>
                        field.onChange(
                          Number(enforceIntegerPattern(event.target.value)) ||
                            0,
                        )
                      }
                    />
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
          )}
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium text-muted-foreground md:hidden">
            {displayColumnTotal}
          </div>
          <div className="flex h-9 items-center justify-start text-sm font-medium tabular-nums md:justify-end">
            {totalDisplay}
          </div>
        </div>

        <div className="flex items-end gap-1 md:justify-end">
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={onEdit}
              aria-label={displayActionEdit}
              title={displayActionEdit}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <UserPen className="h-4 w-4" />
            </Button>
          )}
          {!isFiller && !readOnly && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={onDelete}
              aria-label={displayActionDelete}
              title={displayActionDelete}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 min-w-0 text-xs leading-5 text-muted-foreground md:pr-16">
        <span className="block truncate">{participantsLabel}</span>
      </div>
    </div>
  )
}
