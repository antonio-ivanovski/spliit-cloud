import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'

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
      let newPaidFor = [...paidFor]

      const editedParticipants = Array.from(manuallyEditedParticipants)
      let remainingAmount = totalAmount
      const remainingParticipants =
        newPaidFor.length - editedParticipants.length

      newPaidFor = newPaidFor.map((participant) => {
        if (editedParticipants.includes(participant.participant)) {
          const participantShare = Number(participant.shares) || 0
          if (splitMode === 'BY_AMOUNT') {
            remainingAmount -= participantShare
          }
          return participant
        }
        return participant
      })

      if (remainingParticipants > 0) {
        let amountPerRemaining = 0
        if (splitMode === 'BY_AMOUNT') {
          amountPerRemaining = remainingAmount / remainingParticipants
        }

        newPaidFor = newPaidFor.map((participant) => {
          if (!editedParticipants.includes(participant.participant)) {
            return {
              ...participant,
              shares: Number(
                amountPerRemaining.toFixed(args.payerCurrency.decimal_digits),
              ),
            }
          }
          return participant
        })
      }
      args.form.setValue('paidFor', newPaidFor, { shouldValidate: true })
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
      let newPaidByList = [...paidByList]

      const editedPayers = Array.from(manuallyEditedPayers)
      let remainingAmount = totalAmount
      const remainingPayers = newPaidByList.length - editedPayers.length

      newPaidByList = newPaidByList.map((payer) => {
        if (editedPayers.includes(payer.participant)) {
          const payerShare = Number(payer.shares) || 0
          remainingAmount -= payerShare
          return payer
        }
        return payer
      })

      if (remainingPayers > 0) {
        const amountPerRemaining = remainingAmount / remainingPayers
        newPaidByList = newPaidByList.map((payer) => {
          if (!editedPayers.includes(payer.participant)) {
            return {
              ...payer,
              shares: Number(
                amountPerRemaining.toFixed(args.payerCurrency.decimal_digits),
              ),
            }
          }
          return payer
        })
      }
      args.form.setValue('paidByList', newPaidByList, { shouldValidate: true })
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
