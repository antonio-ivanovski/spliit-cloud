import type { Currency, ExpenseFormInputValues } from '@spliit/domain'
import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'

export function useExpenseFormBalancing(args: {
  form: UseFormReturn<ExpenseFormInputValues>
  groupCurrency: Currency
  payerCurrency: Currency
}): {
  setManuallyEditedParticipants: React.Dispatch<
    React.SetStateAction<Set<string>>
  >
  setManuallyEditedPayers: React.Dispatch<React.SetStateAction<Set<string>>>
} {
  const [manuallyEditedParticipants, setManuallyEditedParticipants] = useState<
    Set<string>
  >(new Set())
  const [manuallyEditedPayers, setManuallyEditedPayers] = useState<Set<string>>(
    new Set(),
  )

  const splitMode = useWatch({
    control: args.form.control,
    name: 'splitMode',
  })
  const paidBySplitMode = useWatch({
    control: args.form.control,
    name: 'paidBySplitMode',
  })
  const amount = useWatch({ control: args.form.control, name: 'amount' })
  const originalCurrency = useWatch({
    control: args.form.control,
    name: 'originalCurrency',
  })
  const originalAmount = useWatch({
    control: args.form.control,
    name: 'originalAmount',
  })

  useEffect(() => {
    setManuallyEditedParticipants(new Set())
  }, [splitMode, amount])

  useEffect(() => {
    setManuallyEditedPayers(new Set())
  }, [paidBySplitMode, amount])

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
      let remainingParticipants = newPaidFor.length - editedParticipants.length

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
                amountPerRemaining.toFixed(args.groupCurrency.decimal_digits),
              ),
            }
          }
          return participant
        })
      }
      args.form.setValue('paidFor', newPaidFor, { shouldValidate: true })
    }
  }, [manuallyEditedParticipants, amount, splitMode])

  useEffect(() => {
    const splitMode = args.form.getValues().paidBySplitMode

    if (
      splitMode === 'BY_AMOUNT' &&
      (args.form.getFieldState('paidByList').isDirty ||
        args.form.getFieldState('amount').isDirty)
    ) {
      const originalCurrencyCode = args.form.getValues('originalCurrency')
      const totalAmount =
        originalCurrencyCode && args.form.getValues('originalAmount') != null
          ? Number(args.form.getValues('originalAmount')) || 0
          : Number(args.form.getValues().amount) || 0

      const paidByList = args.form.getValues().paidByList
      let newPaidByList = [...paidByList]

      const editedPayers = Array.from(manuallyEditedPayers)
      let remainingAmount = totalAmount
      let remainingPayers = newPaidByList.length - editedPayers.length

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
    originalCurrency,
    originalAmount,
  ])

  return { setManuallyEditedParticipants, setManuallyEditedPayers }
}
