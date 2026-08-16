import {
  expensePreviewMetadataSchema,
  prepareExpenseOutputSchema,
  type ExpensePreview,
} from './schemas'

export function createExpensePreviewResult(input: {
  preview: ExpensePreview
  confirmationToken: string
  webUrl: string
}) {
  const props = prepareExpenseOutputSchema.parse({
    preview: input.preview,
    expenseUrlBase: `${input.webUrl}/groups/${input.preview.group.id}/expenses`,
  })
  const metadata = expensePreviewMetadataSchema.parse({
    confirmationToken: input.confirmationToken,
  })
  const payerSummary = input.preview.paidBy
    .map((payer) => payer.name)
    .join(', ')
  const defaults =
    input.preview.defaults.length > 0
      ? ` Defaults used: ${input.preview.defaults
          .map(({ label, value }) => `${label}: ${value}`)
          .join('; ')}.`
      : ''
  const itemSummary = input.preview.items.length
    ? ` It contains ${input.preview.items.length} itemized line ${input.preview.items.length === 1 ? 'item' : 'items'}${input.preview.remainder ? ' plus a proportional or explicit remainder allocation' : ''}.`
    : ''

  return {
    content: [
      {
        type: 'text' as const,
        text: `Interactive expense preview prepared successfully — no expense has been created yet. ${input.preview.title}: ${input.preview.amount} ${input.preview.expenseCurrency.code ?? input.preview.expenseCurrency.symbol} in ${input.preview.group.name}, paid by ${payerSummary}, split ${input.preview.split.mode}, dated ${input.preview.date}.${itemSummary}${defaults} The confirmation card is attached to this result; ask the user to review it and press Create expense.`,
      },
    ],
    structuredContent: props,
    _meta: metadata,
  }
}
