import type { TFunction } from 'i18next'

import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import type { ReportLabels } from '@spliit/api/lib/report/labels'
import { CATEGORY_IDS } from '@spliit/domain'

export function buildReportLabels(
  t: TFunction<'translation', 'ExpenseReport'>,
): ReportLabels {
  const categoryNames: ReportLabels['categoryNames'] = {}
  for (const categoryId of CATEGORY_IDS) {
    categoryNames[categoryId] = categoryLabel(t, categoryId)
  }
  return {
    title: t('title'),
    generatedOnLabel: t('generatedOnLabel'),
    periodLabel: t('periodLabel'),
    balanceAsOfLabel: t('balanceAsOfLabel'),
    totalSpentLabel: t('totalSpentLabel'),
    expensesCountLabel: t('expensesCountLabel'),
    participantsCountLabel: t('participantsCountLabel'),
    participantsSectionLabel: t('participantsSectionLabel'),
    settlementsSectionLabel: t('settlementsSectionLabel'),
    recordedSettlementsSectionLabel: t('recordedSettlementsSectionLabel'),
    expensesSectionLabel: t('expensesSectionLabel'),
    amountColumnLabel: t('amountColumnLabel'),
    participantColumnLabel: t('participantColumnLabel'),
    paidColumnLabel: t('paidColumnLabel'),
    shareColumnLabel: t('shareColumnLabel'),
    balanceColumnLabel: t('balanceColumnLabel'),
    dateColumnLabel: t('dateColumnLabel'),
    fromColumnLabel: t('fromColumnLabel'),
    toColumnLabel: t('toColumnLabel'),
    expenseColumnLabel: t('expenseColumnLabel'),
    categoryColumnLabel: t('categoryColumnLabel'),
    splitLabel: t('splitLabel'),
    noExpensesLabel: t('noExpensesLabel'),
    noParticipantsLabel: t('noParticipantsLabel'),
    noSettlementsLabel: t('noSettlementsLabel'),
    noRecordedSettlementsLabel: t('noRecordedSettlementsLabel'),
    originalAmountLabel: t('originalAmountLabel'),
    categoryNames,
  }
}
