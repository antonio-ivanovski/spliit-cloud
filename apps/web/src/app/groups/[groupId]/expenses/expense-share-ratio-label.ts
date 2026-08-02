import type { SplitMode } from '@spliit/domain'
import { formatDisplayShares, sharesAsDecimal } from '@spliit/domain'

export type ShareSourceRow = { ledgerParticipantId: string; shares: number }

/**
 * Literal ratio label for one participant in a preview/detail split.
 *
 * For `BY_SHARES`, stored rows are fixed units (100 = 1 displayed share) and
 * the label must show the unreduced literal display values — `50, 150` renders
 * `0.5/2` and `1.5/2`, never `50/200` or `1/4`. `EVENLY` stays `1/N`;
 * percentages keep their formatting; amount/itemized rows have no label.
 */
export function expenseShareRatioLabel(
  mode: SplitMode,
  sourceRows: readonly ShareSourceRow[],
  participantId: string,
  locale?: string,
): string | undefined {
  const source = sourceRows.find(
    (row) => row.ledgerParticipantId === participantId,
  )
  if (!source) return undefined

  switch (mode) {
    case 'EVENLY':
      return `1/${sourceRows.length}`
    case 'BY_SHARES': {
      const totalSourceShares = sourceRows.reduce(
        (sum, row) => sum + row.shares,
        0,
      )
      const totalDisplayShares = sharesAsDecimal(totalSourceShares)
      if (totalDisplayShares <= 0) return undefined
      const display = sharesAsDecimal(source.shares)
      // Reuse Intl formatting so `0.5/2` and `1.1/3` are locale-correct.
      return `${formatDisplayShares(display, locale)}/${formatDisplayShares(totalDisplayShares, locale)}`
    }
    case 'BY_PERCENTAGE':
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: 2,
      }).format(source.shares / 10000)
    case 'BY_AMOUNT':
    case 'ITEMIZED':
      return undefined
  }
}
