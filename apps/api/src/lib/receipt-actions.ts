import {
  DEFAULT_CATEGORIES,
  amountAsMinorUnits,
  formatCategoryForAIPrompt,
  getCurrency,
  getCurrencyFromGroup,
} from '@spliit/domain'
import { generateText } from 'ai'
import { getModel } from './ai'
import {
  extractAllowedIdFromAIResponse,
  getLastNonEmptyLine,
} from './ai-response'
import { env } from './env'

type ParsedReceiptAIResponse = {
  amount: number
  categoryId: string | null
  currencyCode: string | null
  date: string | null
  title: string | null
}

function parseAIAmount(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return Number.NaN
  return Number(value.replace(/,/g, '').trim())
}

function parseReceiptJSONResponse(
  content: string,
): ParsedReceiptAIResponse | null {
  try {
    const jsonStart = content.indexOf('{')
    const jsonEnd = content.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd < jsonStart) return null
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as Record<
      string,
      unknown
    >
    return {
      amount: parseAIAmount(parsed.amount ?? parsed.total),
      categoryId:
        typeof parsed.categoryId === 'string' ? parsed.categoryId.trim() : null,
      currencyCode:
        typeof parsed.currencyCode === 'string'
          ? parsed.currencyCode.trim().toUpperCase()
          : null,
      date: typeof parsed.date === 'string' ? parsed.date.trim() : null,
      title:
        typeof parsed.title === 'string'
          ? parsed.title.trim()
          : typeof parsed.merchant === 'string'
            ? parsed.merchant.trim()
            : null,
    }
  } catch {
    return null
  }
}

function parseReceiptAIResponse(rawContent: string | null | undefined) {
  if (!rawContent) {
    return {
      amount: Number.NaN,
      categoryId: null,
      currencyCode: null,
      date: null,
      title: null,
    }
  }

  const jsonResponse = parseReceiptJSONResponse(rawContent)
  if (jsonResponse) return jsonResponse

  const responseLine = getLastNonEmptyLine(rawContent)
  const [amountString, categoryId, date, titleOrCurrency, ...restParts] =
    responseLine.split(',')

  const maybeCurrencyCode = titleOrCurrency?.trim().toUpperCase()
  const hasCurrencyCode =
    !!maybeCurrencyCode && !!getCurrency(maybeCurrencyCode)
  const titleParts = hasCurrencyCode
    ? restParts
    : [titleOrCurrency, ...restParts]

  return {
    amount: parseAIAmount(amountString),
    categoryId: categoryId?.trim() || null,
    currencyCode: hasCurrencyCode ? maybeCurrencyCode : null,
    date: date?.trim() || null,
    title: titleParts.join(',').trim() || null,
  }
}

export async function extractExpenseInformationFromImage(
  imageUrl: string,
  groupCurrencyInput: { currency: string; currencyCode?: string | null },
) {
  const categories = DEFAULT_CATEGORIES
  const categoryIds = categories.map((category) => category.id)
  const groupCurrency = getCurrencyFromGroup(groupCurrencyInput)

  const { text: rawContent } = await generateText({
    model: await getModel(env.AI_RECEIPT_MODEL),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `
              This image contains a receipt.
              Extract the receipt total, best category ID, receipt currency, receipt date, and merchant/title.
              Use the final amount charged, including tax and service charges when visible.
              Return the amount as a plain number without currency symbols or thousands separators.
              Return currencyCode as the ISO 4217 code printed or implied by the receipt.
              If the currency is not printed clearly, infer it from receipt language, merchant name, address, tax labels, phone number, country/city hints, and any other local clues.
              If those clues strongly indicate a country, use that country's normal currency.
              Only return an empty string when there is no reasonable currency inference.
              Return the date as yyyy-mm-dd. If the date is unreadable, return an empty string.
              Return the categoryId from this allowed list only: ${categories.map(
                (category) => formatCategoryForAIPrompt(category),
              )}.
              The group's currency is ${groupCurrency.code || groupCurrency.symbol}; use the receipt total as written and do not convert currencies.
              Return exactly one JSON object with these required fields: amount (number), categoryId (string), currencyCode (string), date (string), and title (string). Do not explain.`,
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'image', image: imageUrl }],
      },
    ],
  })

  const parsed = parseReceiptAIResponse(rawContent)
  parsed.categoryId =
    extractAllowedIdFromAIResponse(parsed.categoryId, categoryIds) ??
    extractAllowedIdFromAIResponse(rawContent, categoryIds)
  const receiptCurrency = parsed.currencyCode
    ? (getCurrency(parsed.currencyCode) ?? groupCurrency)
    : groupCurrency
  parsed.currencyCode = receiptCurrency.code || null
  parsed.amount = amountAsMinorUnits(parsed.amount, receiptCurrency)
  return parsed
}

export type ReceiptExtractedInfo = Awaited<
  ReturnType<typeof extractExpenseInformationFromImage>
>
