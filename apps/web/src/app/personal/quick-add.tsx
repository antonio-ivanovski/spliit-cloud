import { Loader2, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AmountInput } from '@/app/groups/[groupId]/expenses/expense-form/amount-input'
import {
  amountPlaceholder,
  enforceCurrencyPattern,
} from '@/app/groups/[groupId]/expenses/expense-form/currency-utils'
import { CategorySelector } from '@/components/category-selector'
import { Button } from '@/components/ui/button'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { localizeCurrencyInput } from '@/lib/currency-input'
import { useIdempotentCreate } from '@/lib/use-idempotent-create'
import { cn, zonedDateOnlyIso } from '@/lib/utils'
import {
  DEFAULT_CATEGORIES,
  amountAsMinorUnits,
  type CategoryId,
  type Currency,
} from '@spliit/domain'

import {
  useCreatePersonalTransaction,
  usePersonalProfile,
  useSuggestPersonalCategory,
} from './api'
import { usePersonalTranslation } from './personal-i18n'
import type { PersonalEntryKind } from './types'

export type QuickAddOpenState = {
  open: boolean
  defaultKind?: PersonalEntryKind
}

type Props = QuickAddOpenState & {
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

function currencyOrFallback(code: string | undefined): Currency {
  return (
    (code ? getCurrency(code) : undefined) ?? {
      code: code ?? 'USD',
      symbol: code ?? '$',
      rounding: 0,
      decimal_digits: 2,
    }
  )
}

function todayIso(timeZone?: string): string {
  try {
    return zonedDateOnlyIso(new Date(), timeZone ?? 'UTC')
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/**
 * Amount-first quick entry dialog (dialog on desktop, drawer on mobile). Enter
 * submits via the native form; Escape closes via the dialog primitive; the
 * amount field autofocuses through `initialFocus`.
 */
export function PersonalQuickAdd({
  open,
  defaultKind,
  onOpenChange,
  onCreated,
}: Props) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const { toast } = useToast()
  const profileQuery = usePersonalProfile()
  const createMutation = useCreatePersonalTransaction()
  const suggestMutation = useSuggestPersonalCategory()
  const idempotent = useIdempotentCreate()
  const suggestAsyncRef = useRef(suggestMutation.mutateAsync)
  useEffect(() => {
    suggestAsyncRef.current = suggestMutation.mutateAsync
  }, [suggestMutation.mutateAsync])
  const amountRef = useRef<HTMLInputElement>(null)

  const currency = currencyOrFallback(profileQuery.data?.currencyCode)
  const timeZone = profileQuery.data?.timeZone

  const [kind, setKind] = useState<PersonalEntryKind>(defaultKind ?? 'EXPENSE')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<CategoryId>('general')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [suggestedCategory, setSuggestedCategory] = useState<CategoryId | null>(
    null,
  )
  const [date, setDate] = useState(() => todayIso(timeZone))
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const suggestSeqRef = useRef(0)
  const suggestionGuardRef = useRef({ open, kind, categoryTouched, title })
  useEffect(() => {
    suggestionGuardRef.current = { open, kind, categoryTouched, title }
  }, [open, kind, categoryTouched, title])

  // Re-seed the form every time the dialog opens.
  useEffect(() => {
    if (open) {
      // oxlint-disable-next-line react/set-state-in-effect -- intentional form reset on open.
      setKind(defaultKind ?? 'EXPENSE')
      setAmount('')
      setCategoryId('general')
      setCategoryTouched(false)
      setSuggestedCategory(null)
      setDate(todayIso(timeZone))
      setTitle('')
      setNote('')
      setError(null)
    }
  }, [open, defaultKind, timeZone])

  // Title → category suggestion. The server runs the dictionary/history
  // stages and only reaches the model when the deployment allows it. A manual
  // category choice always wins.
  useEffect(() => {
    if (!open || kind !== 'EXPENSE' || categoryTouched) return
    const query = title.trim()
    if (query.length < 3) return
    const sequence = suggestSeqRef.current + 1
    suggestSeqRef.current = sequence
    const handle = setTimeout(() => {
      void suggestAsyncRef
        .current({ title: query, allowAi: true })
        .then((result) => {
          const guard = suggestionGuardRef.current
          if (
            sequence !== suggestSeqRef.current ||
            !guard.open ||
            guard.kind !== 'EXPENSE' ||
            guard.categoryTouched ||
            guard.title.trim() !== query
          ) {
            return
          }
          if (!result.categoryId || result.categoryId === 'general') return
          setSuggestedCategory(result.categoryId as CategoryId)
          setCategoryId(result.categoryId as CategoryId)
        })
        .catch(() => undefined)
    }, 600)
    return () => clearTimeout(handle)
  }, [open, kind, title, categoryTouched])

  const parsedAmount = Number(amount)
  const validationMessage =
    amount.trim() === '' || !Number.isFinite(parsedAmount) || parsedAmount <= 0
      ? t('quickAdd.validationAmount')
      : date === ''
        ? t('quickAdd.validationDate')
        : null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (createMutation.isPending) return
    if (validationMessage) {
      setError(validationMessage)
      return
    }
    setError(null)
    try {
      const created = await idempotent.run((requestId) =>
        createMutation.mutateAsync({
          requestId,
          entry: {
            kind,
            amount: amountAsMinorUnits(parsedAmount, currency),
            currencyCode: currency.code,
            date,
            categoryId,
            ...(title.trim() ? { title: title.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        }),
      )
      if (!created) return
      toast({ description: t('quickAdd.saved') })
      onCreated?.()
      onOpenChange(false)
    } catch (mutationError) {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : t('quickAdd.saveFailed')
      // A completed request whose response was lost can be retried with the
      // same id. If the user edited the payload since, rotate the id once and
      // save as a new entry instead of dead-ending on the idempotency hash.
      if (/different input|already used/i.test(message)) {
        idempotent.reset()
        try {
          const retried = await idempotent.run((requestId) =>
            createMutation.mutateAsync({
              requestId,
              entry: {
                kind,
                amount: amountAsMinorUnits(parsedAmount, currency),
                currencyCode: currency.code,
                date,
                categoryId,
                ...(title.trim() ? { title: title.trim() } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
              },
            }),
          )
          if (retried) {
            toast({ description: t('quickAdd.saved') })
            onCreated?.()
            onOpenChange(false)
            return
          }
        } catch {
          // Fall through to the original error message.
        }
      }
      setError(message)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className="sm:max-w-md"
        initialFocus={amountRef}
        aria-describedby={undefined}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('quickAdd.title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t('quickAdd.description')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form
            id="personal-quick-add-form"
            onSubmit={(event) => void handleSubmit(event)}
            className="flex flex-col gap-4"
          >
            <div
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- toggle pair is labeled by the group; fieldset would break the segmented styling
              role="group"
              aria-label={t('quickAdd.kindLabel')}
              className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
            >
              {(['EXPENSE', 'INCOME'] as const).map((option) => {
                const selected = kind === option
                const Icon = option === 'EXPENSE' ? Minus : Plus
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setKind(option)}
                    className={cn(
                      'flex min-h-10 items-center justify-center gap-1.5 rounded-md text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? option === 'EXPENSE'
                          ? 'bg-background text-foreground shadow-xs'
                          : 'bg-green-600 text-white shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {t(
                      option === 'EXPENSE'
                        ? 'quickAdd.expense'
                        : 'quickAdd.income',
                    )}
                  </button>
                )
              })}
            </div>

            <div className="space-y-2">
              <Label htmlFor="personal-quick-add-amount">
                {t('quickAdd.amount')}
              </Label>
              <AmountInput
                id="personal-quick-add-amount"
                ref={amountRef}
                currency={currency}
                containerClassName="w-full"
                className="h-14 text-2xl font-semibold"
                type="text"
                inputMode="decimal"
                placeholder={amountPlaceholder(currency.decimal_digits, locale)}
                value={localizeCurrencyInput(amount, locale)}
                onChange={(event) => {
                  setAmount(
                    enforceCurrencyPattern(
                      event.target.value,
                      currency.decimal_digits,
                      locale,
                    ),
                  )
                  if (error) setError(null)
                }}
                aria-invalid={error ? true : undefined}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="personal-quick-add-category">
                  {t('quickAdd.category')}
                </Label>
                <CategorySelector
                  categories={DEFAULT_CATEGORIES}
                  defaultValue={categoryId}
                  onValueChange={(value) => {
                    setCategoryId(value as CategoryId)
                    setCategoryTouched(true)
                    setSuggestedCategory(null)
                    if (error) setError(null)
                  }}
                  isLoading={false}
                  ariaLabel={t('quickAdd.category')}
                />
                {suggestedCategory && (
                  <p className="text-xs text-muted-foreground">
                    {t('quickAdd.suggested')}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="personal-quick-add-date">
                  {t('quickAdd.date')}
                </Label>
                <DateInput
                  id="personal-quick-add-date"
                  pickerTitle={t('quickAdd.date')}
                  value={date}
                  max={todayIso(timeZone)}
                  onValueChange={(value) => {
                    setDate(value)
                    if (error) setError(null)
                  }}
                  presets={['yesterday', 'today']}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="personal-quick-add-title">
                {t('quickAdd.titleLabel')}
              </Label>
              <Input
                id="personal-quick-add-title"
                value={title}
                maxLength={200}
                placeholder={t('quickAdd.titlePlaceholder')}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="personal-quick-add-note">
                {t('quickAdd.noteLabel')}
              </Label>
              <Textarea
                id="personal-quick-add-note"
                value={note}
                maxLength={2000}
                rows={2}
                placeholder={t('quickAdd.notePlaceholder')}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            type="submit"
            form="personal-quick-add-form"
            disabled={createMutation.isPending}
            className="w-full sm:w-auto sm:min-w-28"
          >
            {createMutation.isPending && (
              <Loader2
                className="me-2 size-4 animate-spin"
                aria-hidden="true"
              />
            )}
            {createMutation.isPending
              ? t('quickAdd.saving')
              : t('quickAdd.save')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
