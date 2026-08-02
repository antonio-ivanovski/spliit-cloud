import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'

import type { Currency, ExpenseFormInputValues } from '@spliit/domain'

import { buildEqualParticipantRows } from './split-mode-conversions'

export function useExpenseFormBalancing(args: {
  form: UseFormReturn<ExpenseFormInputValues>
  payerCurrency: Currency
}): {
  setManuallyEditedParticipants: React.Dispatch<
    React.SetStateAction<Set<string>>
  >
  setManuallyEditedPayers: React.Dispatch<React.SetStateAction<Set<string>>>
} {
  const splitMode = useWatch({
    control: args.form.control,
    name: 'splitMode',
  })
  const paidBySplitMode = useWatch({
    control: args.form.control,
    name: 'paidBySplitMode',
  })
  // `amount` is the typed value in the selected expense currency, which
  // matches the units paidFor and paidBy BY_AMOUNT shares live in.
  const amount = useWatch({ control: args.form.control, name: 'amount' })

  // Instead of useEffect + setState to reset the sets when splitMode or
  // amount/currency changes, we store the edits together with an "epoch"
  // derived from the watched values. When the epoch changes, the effective
  // set is automatically empty — no effect needed.
  const participantsEpoch = `${splitMode}-${amount}-${args.payerCurrency.code}`
  const payersEpoch = `${paidBySplitMode}-${amount}-${args.payerCurrency.code}`

  const [participantEdits, setParticipantEdits] = useState(() => ({
    epoch: participantsEpoch,
    set: new Set<string>(),
  }))
  const [payerEdits, setPayerEdits] = useState(() => ({
    epoch: payersEpoch,
    set: new Set<string>(),
  }))

  // Derived effective sets — empty when the epoch doesn't match.
  // Wrapped in useMemo so the reference stays stable and downstream
  // effects don't re-run on every render.
  const manuallyEditedParticipants = useMemo(
    () =>
      participantEdits.epoch === participantsEpoch
        ? participantEdits.set
        : new Set<string>(),
    [participantEdits.epoch, participantEdits.set, participantsEpoch],
  )

  const manuallyEditedPayers = useMemo(
    () =>
      payerEdits.epoch === payersEpoch ? payerEdits.set : new Set<string>(),
    [payerEdits.epoch, payerEdits.set, payersEpoch],
  )

  const setManuallyEditedParticipants = useCallback(
    (action: React.SetStateAction<Set<string>>) => {
      setParticipantEdits((prev) => {
        const currentEpoch = participantsEpoch
        const baseSet =
          prev.epoch !== currentEpoch ? new Set<string>() : prev.set
        const nextSet = typeof action === 'function' ? action(baseSet) : action
        return { epoch: currentEpoch, set: nextSet }
      })
    },
    [participantsEpoch],
  )

  const setManuallyEditedPayers = useCallback(
    (action: React.SetStateAction<Set<string>>) => {
      setPayerEdits((prev) => {
        const currentEpoch = payersEpoch
        const baseSet =
          prev.epoch !== currentEpoch ? new Set<string>() : prev.set
        const nextSet = typeof action === 'function' ? action(baseSet) : action
        return { epoch: currentEpoch, set: nextSet }
      })
    },
    [payersEpoch],
  )

  useEffect(() => {
    const splitMode = args.form.getValues().splitMode

    if (
      splitMode === 'BY_AMOUNT' &&
      (args.form.getFieldState('paidFor').isDirty ||
        args.form.getFieldState('amount').isDirty)
    ) {
      const totalAmount = Number(args.form.getValues().amount) || 0
      const paidFor = args.form.getValues().paidFor
      const editedParticipants = manuallyEditedParticipants
      let remainingAmount = totalAmount
      const automaticIds: string[] = []
      for (const participant of paidFor) {
        if (editedParticipants.has(participant.participant)) {
          remainingAmount -= Number(participant.shares) || 0
        } else {
          automaticIds.push(participant.participant)
        }
      }

      // Preserve automatic rows only while the total itself is temporarily
      // zero (for example, while the amount input is cleared and retyped).
      // A nonzero total fully consumed or exceeded by manual rows must remove
      // the stale automatic allocations instead.
      if (automaticIds.length > 0 && totalAmount !== 0) {
        // Independently rounding the remaining amount per participant would
        // lose the residual cent (10.00 over three rows -> 3.33 × 3 = 9.99).
        // buildEqualParticipantRows distributes currency units so the
        // automatic rows sum exactly to the remaining amount. Rows it omits
        // (zero allocation, e.g. fewer cents than participants) are dropped
        // from the list so their checkbox unselects.
        const remainingHasTotalSign =
          remainingAmount !== 0 &&
          Math.sign(remainingAmount) === Math.sign(totalAmount)
        const equalSharesById = new Map(
          remainingHasTotalSign
            ? buildEqualParticipantRows({
                participantIds: automaticIds,
                splitMode: 'BY_AMOUNT',
                targetAmount: remainingAmount,
                currency: {
                  decimal_digits: args.payerCurrency.decimal_digits,
                },
              }).map((row) => [row.participant, row.shares])
            : [],
        )
        const newPaidFor: typeof paidFor = []
        for (const participant of paidFor) {
          if (editedParticipants.has(participant.participant)) {
            newPaidFor.push(participant)
            continue
          }
          const share = equalSharesById.get(participant.participant)
          if (share !== undefined)
            newPaidFor.push({ ...participant, shares: share })
        }
        args.form.setValue('paidFor', newPaidFor, { shouldValidate: true })
      }
    }
  }, [
    manuallyEditedParticipants,
    amount,
    splitMode,
    args.form,
    args.payerCurrency.decimal_digits,
  ])

  useEffect(() => {
    const splitMode = args.form.getValues().paidBySplitMode

    if (
      splitMode === 'BY_AMOUNT' &&
      (args.form.getFieldState('paidByList').isDirty ||
        args.form.getFieldState('amount').isDirty)
    ) {
      const totalAmount = Number(args.form.getValues().amount) || 0
      const paidByList = args.form.getValues().paidByList

      const editedPayers = manuallyEditedPayers
      let remainingAmount = totalAmount
      const automaticIds: string[] = []
      for (const payer of paidByList) {
        if (editedPayers.has(payer.participant)) {
          remainingAmount -= Number(payer.shares) || 0
        } else {
          automaticIds.push(payer.participant)
        }
      }

      // Same total-zero guard as the paid-for effect: preserve rows while the
      // amount is cleared, but remove stale automatic allocations when manual
      // rows consume or exceed a nonzero total.
      if (automaticIds.length > 0 && totalAmount !== 0) {
        // Same residual-corrected distribution as the paid-for effect:
        // automatic rows sum exactly to the remaining amount, and rows the
        // helper omits (zero allocation) are dropped from the list so their
        // checkbox unselects.
        const remainingHasTotalSign =
          remainingAmount !== 0 &&
          Math.sign(remainingAmount) === Math.sign(totalAmount)
        const equalSharesById = new Map(
          remainingHasTotalSign
            ? buildEqualParticipantRows({
                participantIds: automaticIds,
                splitMode: 'BY_AMOUNT',
                targetAmount: remainingAmount,
                currency: {
                  decimal_digits: args.payerCurrency.decimal_digits,
                },
              }).map((row) => [row.participant, row.shares])
            : [],
        )
        const newPaidByList: typeof paidByList = []
        for (const payer of paidByList) {
          if (editedPayers.has(payer.participant)) {
            newPaidByList.push(payer)
            continue
          }
          const share = equalSharesById.get(payer.participant)
          if (share !== undefined)
            newPaidByList.push({ ...payer, shares: share })
        }
        args.form.setValue('paidByList', newPaidByList, {
          shouldValidate: true,
        })
      }
    }
  }, [
    manuallyEditedPayers,
    amount,
    paidBySplitMode,
    args.form,
    args.payerCurrency.decimal_digits,
  ])

  return { setManuallyEditedParticipants, setManuallyEditedPayers }
}
