import { Minus, Plus } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { FieldPath, UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useLocale } from '@/i18n/react'
import { localizeCurrencyInput } from '@/lib/currency-input'
import { cn } from '@/lib/utils'
import type {
  Currency,
  ExpenseFormInputValues,
  SplitMode,
} from '@spliit/domain'
import { MAX_DISPLAY_SHARES } from '@spliit/domain'

import {
  enforceCurrencyPattern,
  enforcePercentagePattern,
  enforceSharePattern,
  stepDisplayShares,
} from './currency-utils'
import { expenseTabPriority } from './focus-navigation'

type ItemSplitMode = Exclude<SplitMode, 'ITEMIZED'>
type ShareRow = { participant: string; shares: number | string }

export type ShareArrayName = 'paidFor' | 'paidByList'
/**
 * The same participant has an input in each section, so registry keys are
 * qualified by the owning array: `paidFor:lp-1` and `paidByList:lp-1` are
 * distinct entries. Keying by participant id alone would let the later paid-by
 * render overwrite the paid-for ref, and unmounting either input could delete
 * the other section's entry.
 */
export type ShareInputKey = `${ShareArrayName}:${string}`

/**
 * Section-qualified registry of the share inputs, owned by the expense form so
 * invalid-submit focus can target a row by array name + participant id. Array
 * indices shift as rows are added/removed, so participant ids — not positions —
 * are the stable identity.
 */
export type ShareInputRefs = MutableRefObject<
  Map<ShareInputKey, HTMLInputElement>
>

type ShareInputProps = {
  className: string
  type: 'text'
  disabled: boolean
  'aria-label': string
  onFocus: (event: React.FocusEvent<HTMLInputElement>) => void
  inputMode: 'decimal'
  step: number
}

/**
 * Registered input for a selected share row. Owns the combined ref callback so
 * it closes over this row's own `field.ref`: when rows above shift and the
 * field re-registers under a new index, `fieldRef` changes identity, React
 * re-invokes the ref, and the previous callback detaches the previous field
 * while the new one wires the new registration. The callback stays stable
 * across keystrokes (the row re-renders on every write), so React never
 * detaches/reattaches the ref while typing. No render-time ref caching is
 * involved.
 */
function SelectedShareInput({
  fieldRef,
  name,
  onBlur,
  attachRef,
  inputProps,
  value,
  onChange,
  percentageSuffix,
}: {
  /** Stable RHF field-ref callback (memoized by useController per name). */
  fieldRef: (element: HTMLInputElement | null) => void
  name: string
  onBlur: () => void
  attachRef: (element: HTMLInputElement | null) => void
  inputProps: ShareInputProps
  value: string
  onChange: (value: string) => void
  percentageSuffix: React.ReactNode
}) {
  const handleRef = useCallback(
    (element: HTMLInputElement | null) => {
      fieldRef(element)
      attachRef(element)
    },
    [fieldRef, attachRef],
  )
  return (
    <>
      <div className="relative">
        <FormControl>
          <Input
            {...inputProps}
            ref={handleRef}
            name={name}
            onBlur={onBlur}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </FormControl>
        {percentageSuffix}
      </div>
      <FormMessage className="float-end" />
    </>
  )
}

// Deliberately no `shouldTouch`: a whole-array write with `shouldTouch`
// would set `touchedFields[arrayName]` to `true`, and the next keystroke
// would replace the nested row shape (`[{ shares: true }, …]`) that a
// share-input blur produced — making the row-error summary gate in the
// cards toggle on every edit. Touched state belongs to the registered
// input's `field.onBlur`; programmatic card operations (mode switches,
// select all/none, balancing) touch the array explicitly at their call
// sites.
const setValueOptions = {
  shouldDirty: true,
  shouldValidate: true,
}

/**
 * Mode-aware share editor for a single participant row in the flat `paidFor` /
 * `paidByList` arrays.
 *
 * The arrays are position-shifting (removing a row re-indexes the rest), so
 * per-row value binding through a path like `paidFor.0.shares` is unsafe — RHF
 * resolves the path by position, not by participant. Values therefore read from
 * the parent array (participant lookup) and every write goes through
 * `form.setValue(arrayName, …)`, the documented pattern for whole-array
 * operations.
 *
 * Only selected rows mount a `FormField` (registered under the real indexed
 * name) so RHF receives the input ref, `aria-invalid` and `aria-describedby`
 * land on the input itself, and the per-row error message is associated with
 * it. Unselected rows render a plain unregistered input — no fake `[-1]` fields
 * shared between rows. Because the input element is replaced when a row is
 * added or removed, focus is restored to the new input in the same commit when
 * the user was typing (see `useLayoutEffect` below).
 */
export function ShareRowInput(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  arrayName: 'paidFor' | 'paidByList'
  rows: ShareRow[]
  participantId: string
  participantName: string
  splitMode: ItemSplitMode
  currency: Currency
  readOnly: boolean
  /**
   * BY_PERCENTAGE shares may be negative on the signed paid-by path (income
   * expenses); paid-for shares never may be.
   */
  allowNegative?: boolean
  markManuallyEdited: (participantId: string) => void
  inputRefs: ShareInputRefs
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const locale = useLocale()
  const {
    form,
    arrayName,
    rows,
    participantId,
    participantName,
    splitMode,
    currency,
    readOnly,
    allowNegative = false,
    markManuallyEdited,
    inputRefs,
  } = props

  const rowIndex = rows.findIndex((row) => row.participant === participantId)
  const row = rowIndex >= 0 ? rows[rowIndex] : undefined
  const isSelected = row != null
  // The registered field name of the selected row's input. Changing when
  // rows above are added/removed (index shift), never on keystrokes.
  const fieldName =
    `${arrayName}[${rowIndex}].shares` as FieldPath<ExpenseFormInputValues>

  // The input element is replaced when a row is added/removed (plain
  // unregistered input ⇄ registered FormField input). Restore focus to the
  // replacement in the same commit so typing continues seamlessly; only when
  // the change came from this row's own input. The caret is placed at the
  // end — the `select()` in `inputProps.onFocus` must NOT apply here, or the
  // next keystroke would replace the just-typed character.
  const inputRef = useRef<HTMLInputElement | null>(null)
  const prevSelectedRef = useRef(isSelected)
  const interactedRef = useRef(false)
  useLayoutEffect(() => {
    if (prevSelectedRef.current !== isSelected && interactedRef.current) {
      const element = inputRef.current
      if (element) {
        element.focus()
        const end = element.value.length
        element.setSelectionRange(end, end)
      }
      interactedRef.current = false
    }
    prevSelectedRef.current = isSelected
  }, [isSelected])

  // Holds the input element for the focus-restore effect below. The
  // section-qualified registry (`inputRefs`) is keyed by array + participant
  // so invalid-submit focus and this local restore share one attach point.
  // oxlint-disable react/react-compiler -- the compiler cannot preserve a
  // memo over the mutable registry Map (`inputRefs.current`); the deps are
  // exhaustive and the captured objects are stable across renders.
  const attachRef = useCallback(
    (element: HTMLInputElement | null) => {
      inputRef.current = element
      const key: ShareInputKey = `${arrayName}:${participantId}`
      if (element) {
        inputRefs.current.set(key, element)
      } else {
        inputRefs.current.delete(key)
      }
    },
    [arrayName, participantId, inputRefs],
  )
  // oxlint-enable react/react-compiler

  if (splitMode === 'EVENLY') return null

  const sanitizer = matchSanitizer(splitMode, currency, locale)
  const labelKey = matchLabelKey(splitMode)

  const writeRows = (next: ShareRow[]) => {
    // Form values type `shares` as number, but the BY_AMOUNT / BY_SHARES
    // editors intentionally keep the raw sanitized string (e.g. "10.") in
    // state; the schema coerces with `z.coerce.number()`.
    form.setValue(
      arrayName,
      next as ExpenseFormInputValues[typeof arrayName],
      setValueOptions,
    )
  }

  const removeRow = () => {
    writeRows(rows.filter((p) => p.participant !== participantId))
  }

  const addOrUpdateRow = (shares: number | string) => {
    writeRows(
      rowIndex >= 0
        ? rows.map((p) =>
            p.participant === participantId ? { ...p, shares } : p,
          )
        : [...rows, { participant: participantId, shares }],
    )
  }

  const handleChange = (rawValue: string) => {
    interactedRef.current = true
    const sanitized = sanitizer(rawValue)

    if (splitMode === 'BY_SHARES') {
      // BY_SHARES keeps the row for any non-empty sanitized string
      // (including "0", "0.", "1.") so typing never makes the input
      // vanish; the row is removed only on an explicit empty value.
      if (sanitized === '') {
        removeRow()
        return
      }
      addOrUpdateRow(sanitized)
      markManuallyEdited(participantId)
      return
    }

    if (splitMode === 'BY_AMOUNT') {
      // Keep in-progress decimals like "0." or "10." in the list so the
      // user can finish typing; remove on explicit "" or "0".
      if (sanitized === '' || sanitized === '0') {
        removeRow()
        return
      }
      addOrUpdateRow(sanitized)
      markManuallyEdited(participantId)
      return
    }

    // BY_PERCENTAGE coerces to number; paid-for keeps rows only while
    // positive, paid-by keeps signed values (income expenses).
    const shares = Number(sanitized)
    const keepInList = allowNegative ? shares !== 0 : shares > 0
    if (!keepInList) {
      removeRow()
      return
    }
    addOrUpdateRow(shares)
    markManuallyEdited(participantId)
  }

  const handleStep = (direction: 1 | -1) => {
    const nextValue = stepDisplayShares(row?.shares, direction)
    if (direction === -1 && nextValue <= 0) {
      removeRow()
      return
    }
    writeRows(
      rowIndex >= 0
        ? rows.map((p) =>
            p.participant === participantId ? { ...p, shares: nextValue } : p,
          )
        : [...rows, { participant: participantId, shares: nextValue }],
    )
  }

  const inputProps = {
    'data-expense-tab-priority':
      arrayName === 'paidFor'
        ? expenseTabPriority.paidFor
        : expenseTabPriority.paidBy,
    className: cn(
      '-my-2 w-[72px] shrink-0 px-2 text-end text-base tabular-nums',
      splitMode === 'BY_PERCENTAGE' && 'pe-5',
    ),
    type: 'text' as const,
    disabled: readOnly,
    'aria-label': t(labelKey, { name: participantName }),
    onFocus: (event: React.FocusEvent<HTMLInputElement>) =>
      event.currentTarget.select(),
    inputMode: 'decimal' as const,
    step:
      splitMode === 'BY_PERCENTAGE' || splitMode === 'BY_SHARES'
        ? 0.01
        : 10 ** -currency.decimal_digits,
  }

  const percentageSuffix = splitMode === 'BY_PERCENTAGE' && (
    <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-muted-foreground">
      %
    </span>
  )

  return (
    <div>
      <div className="flex items-center justify-end gap-0.5">
        {splitMode === 'BY_SHARES' && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            disabled={readOnly || !isSelected}
            aria-label={t('decreaseShares', { name: participantName })}
            onClick={() => handleStep(-1)}
          >
            <Minus className="size-4" aria-hidden="true" />
          </Button>
        )}
        {splitMode === 'BY_AMOUNT' && (
          <span className="text-sm">{currency.symbol}</span>
        )}
        <FormItem className="space-y-0">
          {isSelected ? (
            <FormField
              control={form.control}
              name={fieldName}
              render={({ field }) => (
                <SelectedShareInput
                  fieldRef={field.ref}
                  name={field.name}
                  onBlur={field.onBlur}
                  attachRef={attachRef}
                  inputProps={inputProps}
                  value={localizeCurrencyInput(
                    String(row?.shares ?? ''),
                    locale,
                  )}
                  onChange={handleChange}
                  percentageSuffix={percentageSuffix}
                />
              )}
            />
          ) : (
            // Unselected rows must not register any field (a fake path like
            // `paidFor[-1].shares` would be shared by every unselected row).
            // The plain input still feeds the whole-array write that adds the
            // row on the first keystroke.
            <div className="relative">
              <Input
                {...inputProps}
                ref={attachRef}
                value=""
                onChange={(event) => handleChange(event.target.value)}
              />
              {percentageSuffix}
            </div>
          )}
        </FormItem>
        {splitMode === 'BY_SHARES' && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            disabled={
              readOnly || Number(row?.shares ?? 0) >= MAX_DISPLAY_SHARES
            }
            aria-label={t('increaseShares', { name: participantName })}
            onClick={() => handleStep(1)}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}

const matchSanitizer = (
  splitMode: ItemSplitMode,
  currency: Currency,
  locale: string,
): ((value: string) => string) => {
  if (splitMode === 'BY_PERCENTAGE') {
    return (value) => enforcePercentagePattern(value, locale)
  }
  if (splitMode === 'BY_SHARES') {
    return (value) => enforceSharePattern(value, locale)
  }
  return (value) =>
    enforceCurrencyPattern(value, currency.decimal_digits, locale)
}

const matchLabelKey = (
  splitMode: ItemSplitMode,
):
  | 'participantAmountLabel'
  | 'participantPercentageLabel'
  | 'participantSharesLabel' =>
  splitMode === 'BY_PERCENTAGE'
    ? 'participantPercentageLabel'
    : splitMode === 'BY_SHARES'
      ? 'participantSharesLabel'
      : 'participantAmountLabel'
