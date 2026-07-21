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
import type { GroupContext, RecentExpense } from './ai/context'
import {
  buildGroupContextSection,
  buildLocaleHint,
  buildRecentExpensesSection,
} from './ai/prompt'
import { env } from './env'

type ParsedReceiptAIResponse = {
  amount: number
  categoryId: string | null
  currencyCode: string | null
  date: string | null
  title: string | null
  items: ParsedReceiptItem[]
}

export type ParsedReceiptItem = {
  title: string
  unitPrice: number
  quantity: number
}

export type ReceiptAIContext = {
  recentExpenses?: RecentExpense[]
  locale?: string
  groupContext?: GroupContext
}

function parseAIAmount(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return Number.NaN
  return Number(value.replace(/,/g, '').trim())
}

function parseAIQuantity(value: unknown) {
  const quantity =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/,/g, '').trim())
        : Number.NaN
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null
}

function parseReceiptItems(value: unknown): ParsedReceiptItem[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((rawItem) => {
    if (!rawItem || typeof rawItem !== 'object') return []
    const item = rawItem as Record<string, unknown>
    const titleValue = item.title ?? item.name ?? item.description
    const title = typeof titleValue === 'string' ? titleValue.trim() : ''
    const unitPrice = parseAIAmount(
      item.unitPrice ?? item.unit_price ?? item.price ?? item.amount,
    )
    const quantity = parseAIQuantity(item.quantity ?? item.qty ?? 1)

    if (!title || !Number.isFinite(unitPrice) || unitPrice <= 0 || !quantity) {
      return []
    }
    return [{ title, unitPrice, quantity }]
  })
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
      items: parseReceiptItems(parsed.items ?? parsed.lineItems),
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
      items: [],
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
    items: [],
  }
}

export async function extractExpenseInformationFromImage(
  imageUrl: string,
  groupCurrencyInput: { currency: string; currencyCode?: string | null },
  context: ReceiptAIContext & {
    currentExpense?: {
      title?: string
      amount?: number
      date?: string
      currencyCode?: string
      categoryId?: string
      items?: Array<{ title: string; unitPrice: number; quantity: number }>
    }
  } = {},
) {
  const categories = DEFAULT_CATEGORIES
  const categoryIds = categories.map((category) => category.id)
  const groupCurrency = getCurrencyFromGroup(groupCurrencyInput)
  const groupSection = buildGroupContextSection(context.groupContext)
  const localeHint = buildLocaleHint(context.locale)
  const recentSection = buildRecentExpensesSection(context.recentExpenses ?? [])
  const currentExpenseSection = context.currentExpense
    ? `\nCurrent form values are soft hints only. Re-check them against the receipt and improve or replace them when the image supports it:\n${JSON.stringify(context.currentExpense)}`
    : ''

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
              ${groupSection}
              ${localeHint}
              ${recentSection}
              ${currentExpenseSection}
              Use the group context and past-expense examples only as soft hints for currency, merchant/title, and category; the receipt image is the source of truth. Do not copy an example's amount, date, or items.
              Make a best-effort attempt to extract the purchased receipt line items. For each clearly readable item, return its display title, unit price as a plain positive number in the receipt currency, and positive integer quantity. Exclude taxes, service charges, discounts, subtotals, totals, payment details, and unreadable or uncertain lines. Return an empty items array when no line items can be identified.
              The group's currency is ${groupCurrency.code || groupCurrency.symbol}; use the receipt total as written and do not convert currencies.
              Return exactly one JSON object with these fields: amount (number), categoryId (string), currencyCode (string), date (string), title (string), and items (array of objects with title (string), unitPrice (number), and quantity (integer)). Do not explain.`,
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'file', mediaType: 'image', data: imageUrl }],
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
