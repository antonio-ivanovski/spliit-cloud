import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import type { ExpenseFormInputValues } from '@spliit/domain'
import { serializePaidFor, type Currency, type SplitMode } from '@spliit/domain'

import type { GroupShape } from '../default-values'

const CONFIRMATION_DURATION_MS = 2000

/**
 * Renders a "Save default" link button. After a successful save it swaps to a
 * non-interactive "Saved as default" label for 2 seconds, mirroring the visual
 * rhythm of the existing copy-action feedback, then unmounts.
 *
 * The save is rejected (server + client) when the current split is itemized, so
 * this button should not be rendered in that case (see `DefaultSplitActions`).
 */
export function SaveDefaultButton(props: {
  form: UseFormReturn<ExpenseFormInputValues>
  group: GroupShape
  groupCurrency: Currency
}) {
  const { form, group, groupCurrency } = props
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const setDefaultSplit = trpc.account.setDefaultSplit.useMutation({
    onSuccess: () => {
      void utils.account.defaultSplit.invalidate({ groupId: group.id })
    },
    onError: (error) => {
      toast({ description: error.message, variant: 'destructive' })
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
    // to the server. `serializePaidFor` is the central serializer and
    // routes by splitMode (BY_SHARES → fixed units, BY_PERCENTAGE →
    // basis points, BY_AMOUNT → minor units, EVENLY → ignored).
    const filtered = values.paidFor.filter((row) => Number(row.shares) > 0)
    if (filtered.length === 0) return
    const paidFor = serializePaidFor({
      splitMode,
      amount: 0,
      currency: groupCurrency,
      paidFor: filtered,
    })
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
      <span className="-mx-4 -my-2 px-4 py-2 text-sm text-muted-foreground">
        {t('DefaultSplit.savedAsDefault')}
      </span>
    )
  }

  return (
    <Button
      variant="link"
      type="button"
      className="-mx-4 -my-2"
      disabled={setDefaultSplit.isPending}
      onClick={onClick}
    >
      {t('DefaultSplit.save')}
    </Button>
  )
}
