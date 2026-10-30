import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput } from '@/app/groups/[groupId]/expenses/expense-form/amount-input'
import {
  amountPlaceholder,
  enforceCurrencyPattern,
} from '@/app/groups/[groupId]/expenses/expense-form/currency-utils'
import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { CategorySelector } from '@/components/category-selector'
import { Badge } from '@/components/ui/badge'
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
import { cn, formatCurrency } from '@/lib/utils'
import {
  DEFAULT_CATEGORIES,
  amountAsDecimal,
  amountAsMinorUnits,
  type CategoryId,
} from '@spliit/domain'

import {
  useDeletePersonalTransaction,
  useExcludePersonalEntry,
  useSetPersonalEntryCategory,
  useUpdatePersonalTransaction,
} from './api'
import { PersonalAttachmentsCard } from './attachments-card'
import { usePersonalTranslation } from './personal-i18n'
import type { PersonalEntry } from './types'
import { entryAbsAmount, isSharedEntry } from './types'

type Props = {
  entry: PersonalEntry | null
  currencyCode: string
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

/**
 * Row detail sheet: personal rows get full edit + delete; shared (group) rows
 * get a personal-category override + "Exclude from Personal". The source
 * amount/date/title always follow the group and are read-only for shared rows.
 */
export function PersonalEntryDetail({
  entry,
  currencyCode,
  onOpenChange,
  onChanged,
}: Props) {
  return (
    <ResponsiveDialog
      open={entry != null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false)
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-md">
        {entry && (
          <DetailBody
            key={entry.id}
            entry={entry}
            currencyCode={currencyCode}
            onClose={() => onOpenChange(false)}
            onChanged={onChanged}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function DetailBody({
  entry,
  currencyCode,
  onClose,
  onChanged,
}: {
  entry: PersonalEntry
  currencyCode: string
  onClose: () => void
  onChanged?: () => void
}) {
  const { t } = usePersonalTranslation()
  const shared = isSharedEntry(entry)
  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {shared ? t('entries.detailSharedTitle') : t('entries.detailTitle')}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {shared && entry.group ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{t('entries.sharedBadge')}</Badge>
              <span>{entry.group.name}</span>
            </span>
          ) : (
            entry.date
          )}
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <ResponsiveDialogBody>
        {shared ? (
          <SharedEntryForm
            entry={entry}
            currencyCode={currencyCode}
            onClose={onClose}
            onChanged={onChanged}
          />
        ) : (
          <PersonalEntryForm
            entry={entry}
            currencyCode={currencyCode}
            onClose={onClose}
            onChanged={onChanged}
          />
        )}
      </ResponsiveDialogBody>
    </>
  )
}

function useDoneToast() {
  const { toast } = useToast()
  const { t } = usePersonalTranslation()
  return {
    saved: () => toast({ description: t('entries.saved') }),
    deleted: () => toast({ description: t('entries.deleted') }),
    excluded: () => toast({ description: t('entries.excluded') }),
  }
}

function PersonalEntryForm({
  entry,
  currencyCode,
  onClose,
  onChanged,
}: {
  entry: PersonalEntry
  currencyCode: string
  onClose: () => void
  onChanged?: () => void
}) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const done = useDoneToast()
  const updateMutation = useUpdatePersonalTransaction()
  const deleteMutation = useDeletePersonalTransaction()
  const currency =
    getCurrency(entry.currencyCode ?? currencyCode) ?? getCurrency(currencyCode)

  const [amount, setAmount] = useState(() =>
    currency
      ? amountAsDecimal(entryAbsAmount(entry), currency).toFixed(
          currency.decimal_digits,
        )
      : String(entryAbsAmount(entry)),
  )
  const [categoryId, setCategoryId] = useState<CategoryId>(
    entry.categoryId as CategoryId,
  )
  const [date, setDate] = useState(entry.date)
  const [title, setTitle] = useState(entry.title ?? '')
  const [note, setNote] = useState(entry.note ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = Number(amount)
  const invalid =
    amount.trim() === '' ||
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    date === ''

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (updateMutation.isPending) return
    if (invalid) {
      setError(t('quickAdd.validationAmount'))
      return
    }
    setError(null)
    try {
      await updateMutation.mutateAsync({
        id: entry.id,
        expectedVersion: entry.version,
        entry: {
          kind: entry.kind,
          amount: amountAsMinorUnits(parsed, currency!),
          date,
          categoryId,
          title: title.trim(),
          note: note.trim(),
        },
      })
      done.saved()
      onChanged?.()
      onClose()
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : t('entries.saveFailed'),
      )
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    try {
      await deleteMutation.mutateAsync({ id: entry.id })
      done.deleted()
      onChanged?.()
      onClose()
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : t('entries.saveFailed'),
      )
    }
  }

  useEffect(() => {
    if (!confirmingDelete) return
    const timer = setTimeout(() => setConfirmingDelete(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmingDelete])

  return (
    <form
      onSubmit={(event) => void handleSave(event)}
      className="flex flex-col gap-4"
    >
      <div className="space-y-2">
        <Label htmlFor="personal-entry-amount">{t('quickAdd.amount')}</Label>
        <AmountInput
          id="personal-entry-amount"
          currency={currency ?? undefined}
          containerClassName="w-full"
          className="h-12 text-xl font-semibold"
          type="text"
          inputMode="decimal"
          value={localizeCurrencyInput(amount, locale)}
          placeholder={
            currency
              ? amountPlaceholder(currency.decimal_digits, locale)
              : undefined
          }
          onChange={(event) => {
            setAmount(
              currency
                ? enforceCurrencyPattern(
                    event.target.value,
                    currency.decimal_digits,
                    locale,
                  )
                : event.target.value,
            )
            if (error) setError(null)
          }}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="personal-entry-category">
            {t('quickAdd.category')}
          </Label>
          <CategorySelector
            categories={DEFAULT_CATEGORIES}
            defaultValue={categoryId}
            onValueChange={setCategoryId}
            isLoading={false}
            ariaLabel={t('quickAdd.category')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="personal-entry-date">{t('quickAdd.date')}</Label>
          <DateInput
            id="personal-entry-date"
            pickerTitle={t('quickAdd.date')}
            value={date}
            onValueChange={(value) => {
              setDate(value)
              if (error) setError(null)
            }}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="personal-entry-title">{t('quickAdd.titleLabel')}</Label>
        <Input
          id="personal-entry-title"
          value={title}
          maxLength={200}
          placeholder={t('quickAdd.titlePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="personal-entry-note">{t('quickAdd.noteLabel')}</Label>
        <Textarea
          id="personal-entry-note"
          value={note}
          maxLength={2000}
          rows={2}
          placeholder={t('quickAdd.notePlaceholder')}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <PersonalAttachmentsCard entry={entry} canEdit onChanged={onChanged} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant={confirmingDelete ? 'destructive' : 'outline'}
          onClick={() => void handleDelete()}
          disabled={deleteMutation.isPending}
          className="w-full sm:w-auto"
        >
          {deleteMutation.isPending ? (
            <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="me-2 size-4" aria-hidden="true" />
          )}
          {confirmingDelete ? t('entries.confirmDelete') : t('entries.delete')}
        </Button>
        <Button
          type="submit"
          disabled={updateMutation.isPending}
          className="w-full sm:w-auto sm:min-w-28"
        >
          {updateMutation.isPending && (
            <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
          )}
          {updateMutation.isPending ? t('quickAdd.saving') : t('entries.save')}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  )
}

function SharedEntryForm({
  entry,
  currencyCode,
  onClose,
  onChanged,
}: {
  entry: PersonalEntry
  currencyCode: string
  onClose: () => void
  onChanged?: () => void
}) {
  const { t } = usePersonalTranslation()
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  const locale = useLocale()
  const done = useDoneToast()
  const setCategoryMutation = useSetPersonalEntryCategory()
  const excludeMutation = useExcludePersonalEntry()
  const currency =
    getCurrency(entry.currencyCode ?? currencyCode) ?? getCurrency(currencyCode)

  const [categoryId, setCategoryId] = useState<CategoryId>(
    entry.categoryId as CategoryId,
  )
  const [error, setError] = useState<string | null>(null)
  const dirty = categoryId !== entry.categoryId

  async function handleSaveCategory() {
    if (setCategoryMutation.isPending || !dirty) return
    setError(null)
    try {
      await setCategoryMutation.mutateAsync({ id: entry.id, categoryId })
      done.saved()
      onChanged?.()
      onClose()
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : t('entries.saveFailed'),
      )
    }
  }

  async function handleExclude() {
    if (excludeMutation.isPending) return
    setError(null)
    try {
      await excludeMutation.mutateAsync({ id: entry.id })
      done.excluded()
      onChanged?.()
      onClose()
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : t('entries.saveFailed'),
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
        <p className="font-medium">
          {entry.title ??
            categoryLabel(tCategories, entry.categoryId as CategoryId)}
        </p>
        <p className="mt-0.5 text-muted-foreground tabular-nums">
          {currency
            ? formatCurrency(currency, entryAbsAmount(entry), locale)
            : entryAbsAmount(entry)}
          {' · '}
          {entry.date}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('entries.sharedReadonly')}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="personal-shared-category">
          {t('entries.personalCategory')}
        </Label>
        <CategorySelector
          categories={DEFAULT_CATEGORIES}
          defaultValue={categoryId}
          onValueChange={setCategoryId}
          isLoading={false}
          ariaLabel={t('entries.personalCategory')}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleExclude()}
          disabled={excludeMutation.isPending}
          className={cn('w-full sm:w-auto')}
        >
          {excludeMutation.isPending ? (
            <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
          ) : (
            <AlertTriangle className="me-2 size-4" aria-hidden="true" />
          )}
          {t('entries.exclude')}
        </Button>
        <Button
          type="button"
          onClick={() => void handleSaveCategory()}
          disabled={!dirty || setCategoryMutation.isPending}
          className="w-full sm:w-auto sm:min-w-28"
        >
          {setCategoryMutation.isPending && (
            <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
          )}
          {t('entries.save')}
        </Button>
      </ResponsiveDialogFooter>
    </div>
  )
}
