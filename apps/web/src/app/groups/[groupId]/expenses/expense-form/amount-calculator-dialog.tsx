import { Delete, ListPlus } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import type { Currency } from '@spliit/domain'
import {
  decomposeCalculatorExpression,
  evaluateCalculatorExpression,
  formatCalculatorAmount,
  type CalculatorItem,
} from '@spliit/domain/calculator'

type Key = {
  value: string
  label: string
  variant?: 'default' | 'outline' | 'secondary'
}

type ItemTransferState =
  | 'empty'
  | 'invalid'
  | 'unsupported'
  | 'create'
  | 'replace'

// react-doctor-disable-next-line react-doctor/no-giant-component -- cohesive calculator dialog, keypad+display share expression state
export function AmountCalculatorDialog({
  open,
  onOpenChange,
  expression,
  onExpressionChange,
  currency,
  hasExistingItems,
  onTransferAmount,
  onTransferItems,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expression: string
  onExpressionChange: (expression: string) => void
  currency: Currency
  hasExistingItems: boolean
  onTransferAmount: (value: string) => void
  onTransferItems: (items: CalculatorItem[]) => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })

  const result = useMemo(
    () => evaluateCalculatorExpression(expression),
    [expression],
  )
  const decomposition = useMemo(
    () => decomposeCalculatorExpression(expression),
    [expression],
  )
  const canTransferItems = decomposition.ok
  const isEmptyExpression = !expression || /^0(?:\.0*)?$/.test(expression)
  const itemTransferState: ItemTransferState = isEmptyExpression
    ? 'empty'
    : !result.ok
      ? 'invalid'
      : !canTransferItems
        ? 'unsupported'
        : hasExistingItems
          ? 'replace'
          : 'create'

  const itemTransferCopy = {
    empty: {
      label: t('amountField.calculator.createItems'),
      note: t('amountField.calculator.itemTransferEmpty'),
    },
    invalid: {
      label: t('amountField.calculator.createItems'),
      note: t('amountField.calculator.itemTransferInvalid'),
    },
    unsupported: {
      label: t('amountField.calculator.createItems'),
      note: t('amountField.calculator.itemTransferUnsupported'),
    },
    create: {
      label: t('amountField.calculator.splitIntoItems', {
        count: decomposition.ok ? decomposition.items.length : 0,
      }),
      note: t('amountField.calculator.createItemsHint'),
    },
    replace: {
      label: t('amountField.calculator.replaceItems'),
      note: t('amountField.calculator.replaceItemsHint'),
    },
  }[itemTransferState]

  const itemTransferClassName = {
    empty: 'border-border bg-muted/40 text-muted-foreground',
    invalid:
      'border-destructive/40 bg-destructive/5 text-destructive dark:text-destructive',
    unsupported:
      'border-amber-500/50 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300',
    create: 'bg-primary text-primary-foreground hover:bg-primary/90',
    replace:
      'border-amber-500/60 bg-amber-500/15 text-amber-900 hover:bg-amber-500/25 dark:text-amber-200',
  }[itemTransferState]

  const keys: Key[] = [
    { value: '7', label: '7' },
    { value: '8', label: '8' },
    { value: '9', label: '9' },
    {
      value: '÷',
      label: t('amountField.calculator.divide'),
      variant: 'secondary',
    },
    { value: '4', label: '4' },
    { value: '5', label: '5' },
    { value: '6', label: '6' },
    {
      value: '×',
      label: t('amountField.calculator.multiply'),
      variant: 'secondary',
    },
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    {
      value: '-',
      label: t('amountField.calculator.minus'),
      variant: 'secondary',
    },
    { value: '.', label: t('amountField.calculator.decimal') },
    { value: '0', label: '0' },
    {
      value: '+',
      label: t('amountField.calculator.plus'),
      variant: 'secondary',
    },
  ]

  const transferAmount = () => {
    if (!result.ok) return
    onTransferAmount(formatCalculatorAmount(result.value, currency))
    onOpenChange(false)
  }

  const transferItems = () => {
    if (!decomposition.ok) return
    onTransferItems(decomposition.items)
    onOpenChange(false)
  }

  const updateExpression = (
    updater: string | ((currentExpression: string) => string),
  ) => {
    onExpressionChange(
      typeof updater === 'function' ? updater(expression) : updater,
    )
  }

  const append = (value: string) => {
    updateExpression((currentExpression) => {
      if (/^\d$/.test(value) && currentExpression === '0') return value
      if (
        value === '.' &&
        (currentExpression === '' || currentExpression === '0')
      ) {
        return '0.'
      }
      if (
        '+-×÷'.includes(value) &&
        '+-×÷'.includes(currentExpression.at(-1) ?? '')
      ) {
        return currentExpression.slice(0, -1) + value
      }
      return currentExpression + value
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && result.ok) {
      onTransferAmount(formatCalculatorAmount(result.value, currency))
    }
    onOpenChange(nextOpen)
  }

  // Key handlers are recreated each render. Mirror them in refs so the
  // global keydown effect only re-subscribes when the dialog actually
  // opens/closes, not whenever expression/result/currency change.
  const appendRef = useRef(append)
  const updateExpressionRef = useRef(updateExpression)
  const transferAmountRef = useRef(transferAmount)
  useEffect(() => {
    appendRef.current = append
    updateExpressionRef.current = updateExpression
    transferAmountRef.current = transferAmount
  })

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        appendRef.current(event.key)
        return
      }

      const keyboardOperators: Record<string, string> = {
        '+': '+',
        '-': '-',
        '*': '×',
        x: '×',
        X: '×',
        '/': '÷',
        '.': '.',
        '(': '(',
        ')': ')',
      }
      if (event.key in keyboardOperators) {
        event.preventDefault()
        appendRef.current(keyboardOperators[event.key])
        return
      }

      if (event.key === 'Backspace') {
        event.preventDefault()
        updateExpressionRef.current((currentExpression) =>
          currentExpression.slice(0, -1),
        )
        return
      }

      if (event.key === 'Delete') {
        event.preventDefault()
        updateExpressionRef.current('')
        return
      }

      if (event.key === 'Enter' || event.key === '=') {
        event.preventDefault()
        transferAmountRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="w-full max-w-none gap-5 sm:max-w-sm sm:rounded-xl sm:*:last:hidden">
        <ResponsiveDialogHeader className="sr-only">
          <ResponsiveDialogTitle>
            {t('amountField.calculator.title')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            {t('amountField.calculator.description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-3">
          <div className="overflow-hidden rounded-lg border bg-muted/35 px-4 py-3 text-right shadow-inner">
            <div
              aria-live="polite"
              className="min-h-8 overflow-x-auto font-mono text-2xl tracking-tight whitespace-nowrap tabular-nums"
              data-testid="calculator-expression"
            >
              {expression || '0'}
            </div>
            <div className="mt-1 flex min-h-5 items-center justify-end gap-1 text-sm tabular-nums">
              {result.ok ? (
                <>
                  <span className="text-muted-foreground">=</span>
                  <span className="font-medium">
                    {formatCalculatorAmount(result.value, currency)}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">
                    {currency.symbol}
                  </span>
                </>
              ) : expression ? (
                <span className="text-xs text-destructive">
                  {t('amountField.calculator.invalid')}
                </span>
              ) : null}
            </div>
          </div>

          <Button
            aria-label={`${itemTransferCopy.label}: ${itemTransferCopy.note}`}
            className={`h-14 w-full justify-between gap-3 px-3 text-left ${itemTransferClassName}`}
            disabled={!canTransferItems}
            size="sm"
            type="button"
            variant={itemTransferState === 'create' ? 'default' : 'outline'}
            onClick={transferItems}
          >
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="font-medium">{itemTransferCopy.label}</span>
              <span className="text-xs font-normal opacity-80">
                {itemTransferCopy.note}
              </span>
            </span>
            <ListPlus className="h-4 w-4 shrink-0" />
          </Button>

          <div className="grid grid-cols-4 gap-2">
            <Button
              aria-label={t('amountField.calculator.clear')}
              className="font-semibold"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => updateExpression('')}
            >
              C
            </Button>
            <Button
              aria-label={t('amountField.calculator.backspace')}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => updateExpression((value) => value.slice(0, -1))}
            >
              <Delete className="h-4 w-4" />
            </Button>
            <Button
              aria-label={t('amountField.calculator.openBracket')}
              className="font-mono text-base tabular-nums"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => append('(')}
            >
              (
            </Button>
            <Button
              aria-label={t('amountField.calculator.closeBracket')}
              className="font-mono text-base tabular-nums"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => append(')')}
            >
              )
            </Button>
            {keys.map((key) => (
              <Button
                key={key.value}
                aria-label={key.label}
                className="font-mono text-base tabular-nums"
                size="sm"
                type="button"
                variant={key.variant ?? 'outline'}
                onClick={() => append(key.value)}
              >
                {key.value}
              </Button>
            ))}
          </div>

          <Button
            aria-label={t('amountField.calculator.equals')}
            className="w-full text-lg"
            disabled={!result.ok}
            type="button"
            onClick={transferAmount}
          >
            =
          </Button>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
