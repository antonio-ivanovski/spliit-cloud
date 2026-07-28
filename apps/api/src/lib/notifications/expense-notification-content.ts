/**
 * Shared notification content builders consumed by email and push expense
 * dispatchers. Keeps recurrence description formatting and body/subject
 * construction in one place so the two channel renderers never diverge.
 */
import type {
  RecurrenceActivityMetadata,
  RecurringExpenseSummaryActivityData,
} from '@spliit/domain/activities'

export type SummaryOperation = RecurringExpenseSummaryActivityData['operation']

const FREQUENCY_UNITS: Record<string, { singular: string; plural: string }> = {
  DAILY: { singular: 'day', plural: 'days' },
  WEEKLY: { singular: 'week', plural: 'weeks' },
  MONTHLY: { singular: 'month', plural: 'months' },
  YEARLY: { singular: 'year', plural: 'years' },
}

function cadenceText(frequency: string, interval: number): string {
  const unit = FREQUENCY_UNITS[frequency] ?? {
    singular: frequency.toLowerCase(),
    plural: frequency.toLowerCase(),
  }
  if (interval <= 1) return `Every ${unit.singular}`
  return `Every ${interval} ${unit.plural}`
}

export function formatRecurrenceRule(meta: RecurrenceActivityMetadata): string {
  const cadence = cadenceText(meta.frequency, meta.interval)
  let limitPart = ''
  if (meta.endType === 'COUNT' && meta.occurrenceLimit) {
    limitPart = `, ${meta.occurrenceLimit} total`
  } else if (meta.endType === 'DATE' && meta.endDate) {
    limitPart = `, until ${meta.endDate}`
  }
  return `${cadence}${limitPart}`
}

export function formatRecurrenceRuleBrief(meta: {
  frequency: string
  interval: number
}): string {
  return cadenceText(meta.frequency, meta.interval)
}

export interface RecurringSummaryContent {
  subject: string
  body: string
  title: string
}

export function buildRecurringSummaryContent(params: {
  operation: SummaryOperation
  actorName: string
  displayName: string
  count: number
  title: string | null
  startDate: string
  endDate: string
  stopped?: boolean
  recurrenceMeta?: RecurrenceActivityMetadata | null
}): RecurringSummaryContent {
  const {
    operation,
    actorName,
    displayName,
    count,
    title,
    startDate,
    endDate,
    stopped,
    recurrenceMeta,
  } = params
  const noun = count === 1 ? 'expense' : 'expenses'
  const titleStr = title ? ` "${title}"` : ''
  const period = `from ${startDate} to ${endDate}`
  const recurrenceDesc = recurrenceMeta
    ? ` (${formatRecurrenceRule(recurrenceMeta)})`
    : ''
  const stoppedPart = stopped ? ' and stopped the recurrence' : ''

  switch (operation) {
    case 'create':
      return {
        subject: `[Spliit Cloud] ${count} recurring ${noun} caught up in ${displayName}`,
        body: `${actorName} created ${count} recurring ${noun}${titleStr}${recurrenceDesc} in ${displayName} for ${period}.`,
        title: 'Recurring expenses caught up',
      }
    case 'update':
      return {
        subject: `[Spliit Cloud] ${count} ${noun} updated in ${displayName}`,
        body: `${actorName} updated ${count} recurring ${noun}${titleStr}${recurrenceDesc} in ${displayName} for ${period}${stoppedPart}.`,
        title: 'Recurring expenses updated',
      }
    case 'delete':
      return {
        subject: `[Spliit Cloud] ${count} ${noun} removed from ${displayName}`,
        body: `${actorName} removed ${count} recurring ${noun}${titleStr}${recurrenceDesc} from ${displayName} for ${period}${stoppedPart}.`,
        title: 'Recurring expenses removed',
      }
  }
}
