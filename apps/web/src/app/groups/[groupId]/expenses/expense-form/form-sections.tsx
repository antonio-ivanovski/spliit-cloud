import { ChevronDown, Pin } from 'lucide-react'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useExpenseFormDensity,
  writeExpenseFormDensity,
} from '@/lib/expense-form-density'
import { useMediaQuery } from '@/lib/hooks'
import type { ExpenseFormInputValues } from '@/lib/schemas'
import { cn } from '@/lib/utils'

export type FormSection =
  | 'split'
  | 'notes'
  | 'documents'
  | 'recurrence'
  | 'items'

export function sectionForErrorPath(path: string): FormSection | null {
  if (
    /^(paidFor|splitMode|paidByList|paidBySplitMode|isMultiPayer)(\.|$)/.test(
      path,
    )
  )
    return 'split'
  if (/^(items|itemizedRemainder)(\.|$)/.test(path)) return 'items'
  if (/^recurrence(\.|$)/.test(path)) return 'recurrence'
  if (/^notes(\.|$)/.test(path)) return 'notes'
  if (/^documents(\.|$)/.test(path)) return 'documents'
  return null
}

export function useExpenseFormSections(
  form: UseFormReturn<ExpenseFormInputValues>,
  readOnly: boolean,
  participantCount: number,
) {
  const wide = useMediaQuery('(min-width: 1024px)')
  const density = useExpenseFormDensity()
  const [
    splitMode,
    paidFor,
    isMultiPayer,
    paidByList,
    notes,
    documents,
    recurrence,
    items,
    paidBySplitMode,
  ] = useWatch({
    control: form.control,
    name: [
      'splitMode',
      'paidFor',
      'isMultiPayer',
      'paidByList',
      'notes',
      'documents',
      'recurrence',
      'items',
      'paidBySplitMode',
    ],
  })
  // Signatures omit amounts: changing the total must not reopen a section that
  // the user deliberately collapsed. New content/defaults/recovery do reveal it.
  const signatures: Record<FormSection, string> = {
    split: JSON.stringify([
      splitMode,
      paidBySplitMode,
      isMultiPayer,
      paidFor?.map((r) => r.participant).sort(),
      paidByList?.map((r) => r.participant).sort(),
    ]),
    notes: notes ?? '',
    documents: JSON.stringify(documents?.map((d) => d.url)),
    recurrence: JSON.stringify(recurrence),
    items: JSON.stringify(items?.map((i) => i.id)),
  }
  const populated: Record<FormSection, boolean> = {
    split:
      splitMode !== 'EVENLY' ||
      !!isMultiPayer ||
      paidFor?.length !== participantCount,
    notes: !!notes?.trim(),
    documents: !!documents?.length,
    recurrence: recurrence != null,
    items: !!items?.length || splitMode === 'ITEMIZED',
  }
  const [overrides, setOverrides] = useState<
    Partial<
      Record<FormSection, { open: boolean; signature: string; density: string }>
    >
  >({})
  const isOpen = (section: FormSection) => {
    if (readOnly || (section === 'split' && wide)) return true
    const override = overrides[section]
    if (
      override?.density === density &&
      (override.open || override.signature === signatures[section])
    )
      return override.open
    return (
      populated[section] ||
      (density === 'expanded' &&
        ['split', 'notes', 'documents'].includes(section))
    )
  }
  const setOpen = (section: FormSection, open: boolean) => {
    setOverrides((current) => {
      if (
        current[section]?.open === open &&
        current[section]?.signature === signatures[section] &&
        current[section]?.density === density
      )
        return current
      return {
        ...current,
        [section]: { open, signature: signatures[section], density },
      }
    })
  }
  return { wide, density, readOnly, populated, isOpen, setOpen }
}

type Sections = ReturnType<typeof useExpenseFormSections>
export const FormSectionsContext = createContext<Sections | null>(null)
export function useFormSections() {
  return useContext(FormSectionsContext)
}

/**
 * Keep the editor mounted even when closed: payer synchronization and input
 * recovery are model behavior, not conditional on whether a panel is visible.
 */
export function AddOnSection({
  section,
  title,
  children,
}: {
  section: Exclude<FormSection, 'split'>
  title: string
  children: ReactNode
}) {
  const sections = useFormSections()
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const open = sections?.isOpen(section) ?? true
  const emptyReadOnly = sections?.readOnly && !sections.populated[section]
  return (
    <Card
      hidden={!open || emptyReadOnly}
      data-expense-error-anchor={section}
      className="min-w-0"
      onFocusCapture={() => {
        if (!sections?.readOnly) sections?.setOpen(section, true)
      }}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{title}</CardTitle>
        {!sections?.readOnly && sections && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('simplified.hideSection', { name: title })}
            onClick={() => {
              sections.setOpen(section, false)
              requestAnimationFrame(() =>
                document.getElementById(`expense-addon-${section}`)?.focus(),
              )
            }}
          >
            <ChevronDown className="size-4 rotate-180" aria-hidden="true" />
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function SplitDisclosure({
  summary,
  children,
}: {
  summary: ReactNode
  children: ReactNode
}) {
  const sections = useFormSections()!
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const open = sections.isOpen('split')
  return (
    <Card className="min-w-0" data-expense-split-panel>
      {!sections.wide && (
        <div className="flex items-start gap-2 p-4">
          <div className="min-w-0 flex-1 text-sm leading-relaxed">
            {summary}
          </div>
          {!sections.readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t(
                open ? 'simplified.hideSplit' : 'simplified.showSplit',
              )}
              aria-expanded={open}
              aria-controls="expense-split-editors"
              data-expense-tab-priority={40}
              onClick={() => sections.setOpen('split', !open)}
            >
              <ChevronDown
                className={cn(
                  'size-4 transition-transform',
                  open && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </Button>
          )}
        </div>
      )}
      <div
        id="expense-split-editors"
        hidden={!open}
        onFocusCapture={() => {
          if (!sections.readOnly) sections.setOpen('split', true)
        }}
        className={cn(
          'min-w-0 space-y-5 p-4 sm:p-6',
          !sections.wide && 'border-t',
        )}
      >
        {!sections.wide && !sections.readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={sections.density === 'expanded'}
            onClick={() =>
              writeExpenseFormDensity(
                sections.density === 'expanded' ? 'compact' : 'expanded',
              )
            }
          >
            <Pin className="me-2 size-4" aria-hidden="true" />
            {t('simplified.pin')}
          </Button>
        )}
        {children}
      </div>
    </Card>
  )
}
