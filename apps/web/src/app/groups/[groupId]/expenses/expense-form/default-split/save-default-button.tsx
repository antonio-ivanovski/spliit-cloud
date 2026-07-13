import { Button } from '@/components/ui/button'
import { trpc } from '@/trpc/client'
import type { ExpenseFormInputValues } from '@spliit/domain'
import {
  amountAsMinorUnits,
  type Currency,
  type SplitMode,
} from '@spliit/domain'
import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { percentageToBasisPoints } from '../allocation-engine'
import type { GroupShape } from '../default-values'

const CONFIRMATION_DURATION_MS = 2000

/**
 * Renders a "Save default" link button. After a successful save it
 * swaps to a non-interactive "Saved as default" label for 2 seconds,
 * mirroring the visual rhythm of the existing copy-action feedback,
 * then unmounts.
 *
 * The save is rejected (server + client) when the current split is
 * itemized, so this button should not be rendered in that case (see
 * `DefaultSplitActions`).
 */
export function SaveDefaultButton(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: GroupShape
  groupCurrency: Currency
}) {
  const { form, group, groupCurrency } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const utils = trpc.useUtils()
  const setDefaultSplit = trpc.account.setDefaultSplit.useMutation({
    onSuccess: () => {
      utils.account.defaultSplit.invalidate({ groupId: group.id })
    },
  })

  // `null` = idle, `'saved'` = showing confirmation.
  const [justSaved, setJustSaved] = useState<null | 'saved'>(null)
  useEffect(() => {
    if (justSaved !== 'saved') return
    const timer = setTimeout(() => setJustSaved(null), CONFIRMATION_DURATION_MS)
    return () => clearTimeout(timer)
  }, [justSaved])

  const onClick = () => {
    const values = form.getValues()
    const splitMode = values.splitMode as Exclude<SplitMode, 'ITEMIZED'>

    // Convert display-unit shares back to storage units before sending
    // to the server. The mutation validates against the schema and the
    // participant ids it already knows about.
    const paidFor = values.paidFor
      .filter((row) => Number(row.shares) > 0)
      .map(({ participant, shares }) => ({
        participant,
        shares:
          splitMode === 'BY_PERCENTAGE'
            ? percentageToBasisPoints(Number(shares))
            : splitMode === 'BY_AMOUNT'
              ? amountAsMinorUnits(Number(shares), groupCurrency)
              : Math.round(Number(shares)),
      }))
    if (!paidFor.length) return

    setDefaultSplit.mutate(
      {
        groupId: group.id,
        defaultSplit: { splitMode, paidFor },
      },
      {
        onSuccess: () => setJustSaved('saved'),
      },
    )
  }

  if (justSaved === 'saved') {
    return (
      <span className="text-sm text-muted-foreground -my-2 -mx-4 px-4 py-2">
        {t('DefaultSplit.savedAsDefault')}
      </span>
    )
  }

  return (
    <Button
      variant="link"
      type="button"
      className="-my-2 -mx-4"
      disabled={setDefaultSplit.isPending}
      onClick={onClick}
    >
      {t('DefaultSplit.save')}
    </Button>
  )
}
