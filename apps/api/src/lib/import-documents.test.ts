import { describe, expect, it, vi } from 'vitest'

import {
  discoverSpliitDocuments,
  fetchSourceDocument,
  openSourceDocumentClaims,
} from './import-documents'

function trpcResponse(data: unknown) {
  return new Response(JSON.stringify({ result: { data: { json: data } } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('discoverSpliitDocuments', () => {
  it('seals embedded export links without calling the live upstream API', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const result = await discoverSpliitDocuments({
      accountId: 'account-1',
      sessionId: '00000000-0000-4000-8000-000000000001',
      sourceGroupId: 'group-1',
      exportVersion: 3,
      expenses: [
        {
          title: 'Dinner',
          sourceDocuments: [
            {
              sourceId: 'doc-1',
              sourceUrl: 'https://receipts.example.com/doc-1.jpg',
              width: 800,
              height: 1200,
            },
          ],
        },
        { title: 'No receipt', sourceDocuments: [] },
      ],
      fetchImpl: fetchMock,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.failures).toEqual([])
    expect(result.documents).toHaveLength(1)
    const claims = await openSourceDocumentClaims(result.documents[0].token)
    expect(claims).toMatchObject({
      accountId: 'account-1',
      expenseIndex: 0,
      sourceDocumentId: 'doc-1',
      sourceUrl: 'https://receipts.example.com/doc-1.jpg',
      width: 800,
      height: 1200,
    })
  })

  it('matches a live expense by createdAt and seals its document URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        trpcResponse({
          expenses: [
            {
              id: 'expense-1',
              createdAt: '2025-11-15T00:00:00.000Z',
              title: 'Dinner',
              _count: { documents: 1 },
            },
          ],
          hasMore: false,
          nextCursor: 100,
        }),
      )
      .mockResolvedValueOnce(
        trpcResponse({
          expense: {
            id: 'expense-1',
            createdAt: '2025-11-15T00:00:00.000Z',
            title: 'Dinner',
            documents: [
              {
                id: 'doc-1',
                url: 'https://receipts.example.com/doc-1.jpg',
                width: 800,
                height: 1200,
              },
            ],
          },
        }),
      )

    const result = await discoverSpliitDocuments({
      accountId: 'account-1',
      sessionId: '00000000-0000-4000-8000-000000000001',
      sourceGroupId: 'group-1',
      expenses: [
        {
          sourceCreatedAt: '2025-11-15T00:00:00.000Z',
          title: 'Dinner',
        },
      ],
      fetchImpl: fetchMock,
    })

    expect(result.failures).toEqual([])
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]).toMatchObject({
      expenseIndex: 0,
      sourceDocumentId: 'doc-1',
    })
    const claims = await openSourceDocumentClaims(result.documents[0].token)
    expect(claims).toMatchObject({
      accountId: 'account-1',
      expenseIndex: 0,
      sourceUrl: 'https://receipts.example.com/doc-1.jpg',
    })
  })

  it('reports an ambiguous timestamp instead of guessing', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      trpcResponse({
        expenses: [
          {
            id: 'expense-1',
            createdAt: '2025-11-15T00:00:00.000Z',
            title: 'Dinner',
            _count: { documents: 1 },
          },
        ],
        hasMore: false,
      }),
    )
    const result = await discoverSpliitDocuments({
      accountId: 'account-1',
      sessionId: '00000000-0000-4000-8000-000000000001',
      sourceGroupId: 'group-1',
      expenses: [
        { sourceCreatedAt: '2025-11-15T00:00:00.000Z', title: 'Dinner' },
        { sourceCreatedAt: '2025-11-15T00:00:00.000Z', title: 'Dinner' },
      ],
      fetchImpl: fetchMock,
    })
    expect(result.documents).toEqual([])
    expect(result.failures[0].documentCount).toBe(1)
    expect(result.failures[0].message).toMatch(/ambiguous/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a same-timestamp expense when its title does not match', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      trpcResponse({
        expenses: [
          {
            id: 'expense-1',
            createdAt: '2025-11-15T00:00:00.000Z',
            title: 'Different dinner',
            _count: { documents: 2 },
          },
        ],
        hasMore: false,
      }),
    )
    const result = await discoverSpliitDocuments({
      accountId: 'account-1',
      sessionId: '00000000-0000-4000-8000-000000000001',
      sourceGroupId: 'group-1',
      expenses: [
        { sourceCreatedAt: '2025-11-15T00:00:00.000Z', title: 'Dinner' },
      ],
      fetchImpl: fetchMock,
    })

    expect(result.documents).toEqual([])
    expect(result.failures[0]).toMatchObject({
      documentCount: 2,
      expenseTitle: 'Different dinner',
    })
    expect(result.failures[0].message).toMatch(/title/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('fetchSourceDocument', () => {
  it('rejects private source addresses before fetching', async () => {
    const fetchMock = vi.fn<typeof fetch>()

    await expect(
      fetchSourceDocument('https://127.0.0.1/receipt.jpg', fetchMock),
    ).rejects.toThrow(/private/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects IPv4-mapped IPv6 loopback addresses before fetching', async () => {
    const fetchMock = vi.fn<typeof fetch>()

    await expect(
      fetchSourceDocument(
        'https://[0:0:0:0:0:ffff:127.0.0.1]/receipt.jpg',
        fetchMock,
      ),
    ).rejects.toThrow(/private/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a redirect from a public URL to a private address', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://127.0.0.1/internal.jpg' },
      }),
    )

    await expect(
      fetchSourceDocument('https://93.184.216.34/receipt.jpg', fetchMock),
    ).rejects.toThrow(/private/i)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
