import { useTranslation } from 'react-i18next'

import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  INCOME_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  isSettlementCategory,
} from '@spliit/domain'

export type CategorySideEffectKind = 'settlement' | 'income'

export function getCategorySideEffectKind(
  categoryId: string | null | undefined,
): CategorySideEffectKind | null {
  if (categoryId && isSettlementCategory(categoryId)) return 'settlement'
  if (categoryId === INCOME_CATEGORY_ID) return 'income'
  return null
}

type CategorySideEffectBadgeProps = {
  kind: CategorySideEffectKind
}

export function CategorySideEffectBadge({
  kind,
}: CategorySideEffectBadgeProps) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  const { t: tForm } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  const label = kind === 'settlement' ? t('settlementBadge') : t('incomeBadge')
  const categoryId =
    kind === 'settlement' ? SETTLEMENT_CATEGORY_ID : INCOME_CATEGORY_ID
  const hint = tForm(kind === 'settlement' ? 'settlementHint' : 'incomeHint', {
    category: categoryLabel(tCategories, categoryId),
  })

  return (
    <TooltipProvider delay={300} closeDelay={100}>
      <Tooltip>
        <TooltipTrigger
          render={<span className="relative z-10 inline-flex shrink-0" />}
        >
          <Badge variant="secondary" className="text-xs">
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-56 font-normal">{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
