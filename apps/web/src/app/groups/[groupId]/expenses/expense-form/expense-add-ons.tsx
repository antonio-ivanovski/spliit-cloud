import { FileText, Paperclip, Repeat, ListPlus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import type { ExpenseFormInputValues } from '@/lib/schemas'
import { cn } from '@/lib/utils'

import { ExpenseDateTimeField } from './expense-date-time-field'
import { expenseTabPriority } from './focus-navigation'
import {
  AddOnSection,
  useFormSections,
  type FormSection,
} from './form-sections'
import { RecurrenceSection, defaultRecurrence } from './recurrence-section'

export function ExpenseAddOns({
  form,
  readOnly,
  sExpense,
  documentsEnabled,
  recurrenceSequence,
  editScope,
  initialRecurrence,
  documents,
  items,
  onPickDocuments,
}: {
  form: UseFormReturn<ExpenseFormInputValues>
  readOnly: boolean
  sExpense: 'Expense' | 'Income'
  documentsEnabled: boolean
  recurrenceSequence?: number
  editScope?: 'OCCURRENCE' | 'THIS_AND_FUTURE' | null
  initialRecurrence?: ExpenseFormInputValues['recurrence']
  documents: ReactNode
  items: ReactNode
  onPickDocuments: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const sections = useFormSections()!
  const addons = [
    { id: 'notes', icon: FileText, label: t('simplified.note') },
    ...(documentsEnabled
      ? [{ id: 'documents', icon: Paperclip, label: t('simplified.receipt') }]
      : []),
    { id: 'recurrence', icon: Repeat, label: t('simplified.repeat') },
    { id: 'items', icon: ListPlus, label: t('simplified.items') },
  ] as const
  return (
    <div className="min-w-0 space-y-4">
      <div className="rounded-lg border bg-card p-4 sm:p-6">
        <ExpenseDateTimeField
          form={form}
          readOnly={readOnly}
          sExpense={sExpense}
          compact={
            !readOnly && !sections.wide && sections.density === 'compact'
          }
        />
        {!readOnly && (
          <div className="mt-4 flex flex-wrap gap-2">
            {addons
              .filter((addon) => !sections.isOpen(addon.id as FormSection))
              .map((addon) => (
                <Button
                  key={addon.id}
                  id={`expense-addon-${addon.id}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    'gap-2 rounded-full font-normal',
                    sections.populated[addon.id as FormSection] &&
                      'border-primary/30 bg-primary/5 text-primary',
                  )}
                  data-expense-tab-priority={expenseTabPriority.addons}
                  onClick={() => {
                    sections.setOpen(addon.id as FormSection, true)
                    if (addon.id === 'documents') onPickDocuments()
                    if (
                      addon.id === 'recurrence' &&
                      !form.getValues('recurrence')
                    )
                      form.setValue('recurrence', defaultRecurrence, {
                        shouldDirty: true,
                        shouldTouch: true,
                        shouldValidate: true,
                      })
                    if (addon.id !== 'documents')
                      requestAnimationFrame(() => {
                        if (addon.id === 'notes') form.setFocus('notes')
                        else
                          document
                            .querySelector<HTMLElement>(
                              `[data-expense-error-anchor="${addon.id}"] button, [data-expense-error-anchor="${addon.id}"] input`,
                            )
                            ?.focus()
                      })
                  }}
                >
                  <addon.icon className="size-3.5" aria-hidden="true" />
                  {addon.label}
                </Button>
              ))}
          </div>
        )}
      </div>
      <AddOnSection section="notes" title={t('notesField.label')}>
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">{t('notesField.label')}</FormLabel>
              <FormControl>
                <Textarea
                  className="min-h-24 resize-y text-base"
                  disabled={readOnly}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </AddOnSection>
      {documentsEnabled && (
        <AddOnSection section="documents" title={t('attachDocuments')}>
          {documents}
        </AddOnSection>
      )}
      <AddOnSection section="recurrence" title={t('simplified.repeat')}>
        <RecurrenceSection
          form={form}
          readOnly={readOnly}
          currentSequence={recurrenceSequence}
          editScope={editScope}
          initialRecurrence={initialRecurrence}
        />
      </AddOnSection>
      <AddOnSection section="items" title={t('items.title')}>
        {items}
      </AddOnSection>
    </div>
  )
}
