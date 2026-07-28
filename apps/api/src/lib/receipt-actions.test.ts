import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('./ai', () => ({ getModel: vi.fn() }))
vi.mock('./env', () => ({
  env: { AI_RECEIPT_MODEL: 'test-receipt-model' },
}))

const { generateText } = await import('ai')
const { getModel } = await import('./ai')
const { extractExpenseInformationFromImage } = await import('./receipt-actions')

const generateTextMock = vi.mocked(generateText)
const getModelMock = vi.mocked(getModel)

const groupCurrency = { currency: '$', currencyCode: 'USD' }

beforeEach(() => {
  generateTextMock.mockReset()
  getModelMock.mockReset()
  getModelMock.mockResolvedValue({ id: 'test-receipt-model' } as never)
})

describe('extractExpenseInformationFromImage', () => {
  it('extracts receipt metadata and best-effort item details from JSON', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        amount: 18.5,
        categoryId: 'groceries',
        currencyCode: 'USD',
        date: '2025-01-02',
        title: 'Corner Market',
        items: [
          { title: 'Apples', unitPrice: 2.5, quantity: 2 },
          { title: 'Bread', unitPrice: 3.5, quantity: 1 },
        ],
      }),
    })

    const result = await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
    )

    expect(result).toMatchObject({
      amount: 1850,
      categoryId: 'groceries',
      currencyCode: 'USD',
      date: '2025-01-02',
      title: 'Corner Market',
      items: [
        { title: 'Apples', unitPrice: 2.5, quantity: 2 },
        { title: 'Bread', unitPrice: 3.5, quantity: 1 },
      ],
    })
  })

  it('filters malformed item entries while retaining valid items despite total mismatch', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        amount: 10,
        currencyCode: 'USD',
        items: [
          { title: 'Valid item', unitPrice: 4.25, quantity: 1 },
          { title: '   ', unitPrice: 2, quantity: 1 },
          { title: 'Zero price', unitPrice: 0, quantity: 1 },
          { title: 'Negative quantity', unitPrice: 2, quantity: -1 },
          { title: 'Fractional quantity', unitPrice: 2, quantity: 1.5 },
          { title: 'Missing price', quantity: 1 },
          null,
        ],
      }),
    })

    const result = await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
    )

    expect(result.items).toEqual([
      { title: 'Valid item', unitPrice: 4.25, quantity: 1 },
    ])
  })

  it('returns no items for the legacy comma-separated response format', async () => {
    generateTextMock.mockResolvedValue({
      text: '12.34,groceries,2025-01-02,USD,Corner Market',
    })

    const result = await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
    )

    expect(result).toMatchObject({
      amount: 1234,
      categoryId: 'groceries',
      currencyCode: 'USD',
      date: '2025-01-02',
      title: 'Corner Market',
      items: [],
    })
  })

  it('returns an empty item list when the model has no usable response', async () => {
    generateTextMock.mockResolvedValue({ text: '' })

    const result = await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
    )

    expect(result.items).toEqual([])
    expect(result.amount).toBeNaN()
  })

  it('asks the model to return item names, prices, and quantities', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ amount: 1, items: [] }),
    })

    await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
    )

    const request = generateTextMock.mock.calls[0]?.[0] as {
      messages: Array<{
        content: Array<{ type: string; text?: string }>
      }>
    }
    const prompt = request.messages[0]?.content.find(
      (part) => part.type === 'text',
    )?.text

    expect(prompt).toMatch(/items/i)
    expect(prompt).toMatch(/unitPrice/i)
    expect(prompt).toMatch(/quantity/i)
  })

  it('uses the current AI SDK file part for receipt images', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ amount: 1, items: [] }),
    })

    const imageUrl = 'https://example.com/receipt.jpg'
    await extractExpenseInformationFromImage(imageUrl, groupCurrency)

    const request = generateTextMock.mock.calls[0]?.[0] as {
      messages: Array<{
        content: Array<{
          type: string
          mediaType?: string
          data?: string
        }>
      }>
    }
    expect(request.messages[1]?.content).toContainEqual({
      type: 'file',
      mediaType: 'image',
      data: imageUrl,
    })
  })

  it('includes group, locale, and past-expense context as soft hints', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ amount: 1, items: [] }),
    })

    await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
      {
        locale: 'es',
        groupContext: {
          name: 'Madrid Trip',
          currency: '€',
          currencyCode: 'EUR',
        },
        recentExpenses: [{ title: 'Mercadona', categoryId: 'groceries' }],
      },
    )

    const request = generateTextMock.mock.calls[0]?.[0] as {
      messages: Array<{
        content: Array<{ type: string; text?: string }>
      }>
    }
    const prompt = request.messages[0]?.content.find(
      (part) => part.type === 'text',
    )?.text

    expect(prompt).toContain('Madrid Trip')
    expect(prompt).toContain('EUR')
    expect(prompt).toContain("user's app language is Español")
    expect(prompt).toContain('"Mercadona" -> groceries')
    expect(prompt).toContain('soft hints')
  })

  it('does not add a forced-translation instruction when translateToLocale is omitted', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ amount: 1, items: [] }),
    })

    await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
      { locale: 'es' },
    )

    const request = generateTextMock.mock.calls[0]?.[0] as {
      messages: Array<{
        content: Array<{ type: string; text?: string }>
      }>
    }
    const prompt = request.messages[0]?.content.find(
      (part) => part.type === 'text',
    )?.text

    expect(prompt).not.toContain('Translate the returned expense title')
  })

  it('does not add a forced-translation instruction when translateToLocale is false', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ amount: 1, items: [] }),
    })

    await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
      { locale: 'es', translateToLocale: false },
    )

    const request = generateTextMock.mock.calls[0]?.[0] as {
      messages: Array<{
        content: Array<{ type: string; text?: string }>
      }>
    }
    const prompt = request.messages[0]?.content.find(
      (part) => part.type === 'text',
    )?.text

    expect(prompt).not.toContain('Translate the returned expense title')
  })

  it('adds a forced-translation instruction naming the language when enabled', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ amount: 1, items: [] }),
    })

    await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
      { locale: 'es', translateToLocale: true },
    )

    const request = generateTextMock.mock.calls[0]?.[0] as {
      messages: Array<{
        content: Array<{ type: string; text?: string }>
      }>
    }
    const prompt = request.messages[0]?.content.find(
      (part) => part.type === 'text',
    )?.text

    expect(prompt).toContain('Translate the returned expense title')
    expect(prompt).toContain('Español')
    expect(prompt).toContain('every item title')
  })

  it('does not add a malformed instruction for unknown locale even when enabled', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ amount: 1, items: [] }),
    })

    await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
      { locale: 'xx-UNKNOWN', translateToLocale: true },
    )

    const request = generateTextMock.mock.calls[0]?.[0] as {
      messages: Array<{
        content: Array<{ type: string; text?: string }>
      }>
    }
    const prompt = request.messages[0]?.content.find(
      (part) => part.type === 'text',
    )?.text

    expect(prompt).not.toContain('Translate the returned expense title')
  })

  it('preserves parsing and money conversion with translation enabled', async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        amount: 25.99,
        categoryId: 'groceries',
        currencyCode: 'EUR',
        date: '2025-06-15',
        title: 'Restaurante El Sol',
        items: [{ title: 'Paella', unitPrice: 25.99, quantity: 1 }],
      }),
    })

    const result = await extractExpenseInformationFromImage(
      'https://example.com/receipt.jpg',
      groupCurrency,
      { locale: 'es', translateToLocale: true },
    )

    expect(result).toMatchObject({
      amount: 2599,
      categoryId: 'groceries',
      currencyCode: 'EUR',
      date: '2025-06-15',
      title: 'Restaurante El Sol',
      items: [{ title: 'Paella', unitPrice: 25.99, quantity: 1 }],
    })
  })
})
