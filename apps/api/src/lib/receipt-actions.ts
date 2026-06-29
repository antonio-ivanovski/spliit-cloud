import { DEFAULT_CATEGORIES, formatCategoryForAIPrompt } from '@spliit/domain'
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/index.mjs'
import { env } from './env'
import { getOpenAIClient } from './openai'

export async function extractExpenseInformationFromImage(imageUrl: string) {
  const openai = getOpenAIClient()
  const categories = DEFAULT_CATEGORIES

  const body: ChatCompletionCreateParamsNonStreaming = {
    model: env.OPENAI_RECEIPT_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `
              This image contains a receipt.
              Read the total amount and store it as a non-formatted number without any other text or currency.
              Then guess the category for this receipt among the following categories and store its ID: ${categories.map(
                (category) => formatCategoryForAIPrompt(category),
              )}.
              Guess the expense’s date and store it as yyyy-mm-dd.
              Guess a title for the expense.
              Return the amount, the category, the date and the title with just a comma between them, without anything else.`,
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: imageUrl } }],
      },
    ],
  }
  const completion = await openai.chat.completions.create(body)

  const [amountString, categoryId, date, title] = completion.choices
    .at(0)
    ?.message.content?.split(',') ?? [null, null, null, null]
  return { amount: Number(amountString), categoryId, date, title }
}

export type ReceiptExtractedInfo = Awaited<
  ReturnType<typeof extractExpenseInformationFromImage>
>
