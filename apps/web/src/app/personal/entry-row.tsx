import { ArrowDownLeft, Paperclip, Repeat } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import {
  categoryFromId,
  categoryLabel,
} from '@/app/groups/[groupId]/stats/category-utils'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { cn, formatCurrency } from '@/lib/utils'
import type { CategoryId } from '@spliit/domain'

import { usePersonalTranslation } from './personal-i18n'
import type { PersonalEntry } from './types'
import { entryAbsAmount, isSharedEntry } from './types'

type Props = {
  entry: PersonalEntry
  currencyCode: string
  onSelect?: (entry: PersonalEntry) => void
}

/**
 * One personal ledger row: category icon, title/group, badge for shared
 * entries, and the signed amount. Renders as a button when selectable so the
 * row detail dialog opens with keyboard support.
 */
export function PersonalEntryRow({ entry, currencyCode, onSelect }: Props) {
  const { t } = usePersonalTranslation()
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  const locale = useLocale()
  const currency =
    getCurrency(entry.currencyCode ?? currencyCode) ?? getCurrency(currencyCode)
  const isIncome = entry.kind === 'INCOME'
  const shared = isSharedEntry(entry)
  const categoryId = entry.categoryId as CategoryId
  const label = entry.title || categoryLabel(tCategories, categoryId)

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          isIncome
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : 'bg-primary/10 text-primary',
        )}
      >
        {isIncome ? (
          <ArrowDownLeft className="size-4.5" />
        ) : (
          <CategoryIcon
            category={categoryFromId(categoryId)}
            className="size-4.5"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium">{label}</span>
          {shared && (
            <Badge variant="secondary" className="shrink-0 text-[11px]">
              {t('entries.sharedBadge')}
            </Badge>
          )}
          {entry.recurring && (
            <Badge
              variant="outline"
              className="shrink-0 text-[11px]"
              title={t('entries.recurringBadge')}
            >
              <Repeat
                className="mr-0.5 size-3"
                aria-label={t('entries.recurringBadge')}
              />
              {t('entries.recurringBadge')}
            </Badge>
          )}
          {entry.attachments.length > 0 && (
            <Paperclip
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
              data-testid="personal-entry-attachments"
            />
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {shared && entry.group
            ? entry.group.name
            : categoryLabel(tCategories, categoryId)}
          {entry.note ? ` · ${entry.note}` : ''}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          isIncome ? 'text-green-600 dark:text-green-400' : 'text-foreground',
        )}
      >
        {isIncome ? '+' : '−'}
        {currency
          ? formatCurrency(currency, entryAbsAmount(entry), locale)
          : entryAbsAmount(entry)}
      </span>
    </>
  )

  if (!onSelect) {
    return (
      <li className="flex items-center gap-3 rounded-lg px-2 py-2.5">{body}</li>
    )
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(entry)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-start outline-hidden transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${label} · ${entry.date}`}
      >
        {body}
      </button>
    </li>
  )
}
