import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'
import type { NormalizedSource } from '@spliit/domain/import'

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  presign: vi.fn(),
  resizeImage: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      discoverImportDocuments: {
        useMutation: () => ({ mutateAsync: mocks.discover }),
      },
    },
    uploads: {
      importDocumentPresign: {
        useMutation: () => ({ mutateAsync: mocks.presign }),
      },
    },
  },
}))

vi.mock('@/lib/upload', () => ({
  resizeImage: mocks.resizeImage,
}))

import { DocumentsStep } from './documents-step'

const source: NormalizedSource = {
  provider: 'SPLIIT',
  sourceGroupId: 'source-group',
  sourceUrl: 'https://spliit.app/groups/source-group',
  name: 'Trip',
  currency: '€',
  currencyCode: 'EUR',
  participants: [],
  expenses: [
    {
      sourceCreatedAt: '2025-01-01T10:00:00.000Z',
      title: 'Dinner',
      expenseDate: '2025-01-01',
      category: 'food',
      amountCurrency: 'EUR',
      amount: 1000,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      paidBySourceId: 'participant-1',
      paidBy: [{ sourceId: 'participant-1', shares: 1000 }],
      paidFor: [{ sourceId: 'participant-1', shares: 1000 }],
      splitMode: 'BY_AMOUNT',
      recurrenceRule: 'NONE',
      isReimbursement: false,
      notes: null,
    },
  ],
}

function renderStep(onContinue = vi.fn()) {
  render(
    <DocumentsStep
      source={source}
      sessionId="00000000-0000-4000-8000-000000000001"
      initialTokens={[]}
      initialRecoveredCount={0}
      initialSkippedCount={0}
      initialSkippedEntirely={false}
      initialCompleted={false}
      onBack={vi.fn()}
      onContinue={onContinue}
    />,
  )
  return onContinue
}

describe('DocumentsStep', () => {
  beforeEach(() => {
    mocks.discover.mockReset()
    mocks.presign.mockReset()
    mocks.resizeImage.mockReset()
    mocks.resizeImage.mockImplementation(async (file: File) => ({
      file,
      width: 640,
      height: 480,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the standard Continue action and records an unchecked choice', async () => {
    const user = userEvent.setup()
    const onContinue = renderStep()

    await user.click(
      screen.getByRole('checkbox', { name: /find and copy documents/i }),
    )
    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )

    expect(mocks.discover).not.toHaveBeenCalled()
    expect(onContinue).toHaveBeenCalledWith({
      stagedTokens: [],
      recoveredCount: 0,
      skippedCount: 0,
      skippedEntirely: true,
    })
  })

  it('shows partial loss in a dialog and can continue with recovered documents', async () => {
    const user = userEvent.setup()
    const onContinue = renderStep()
    mocks.discover.mockResolvedValue({
      failures: [],
      documents: [
        {
          expenseIndex: 0,
          expenseTitle: 'Dinner',
          sourceDocumentId: 'doc-1',
          width: 640,
          height: 480,
          token: 'source-token-1',
        },
        {
          expenseIndex: 0,
          expenseTitle: 'Dinner',
          sourceDocumentId: 'doc-2',
          width: 640,
          height: 480,
          token: 'source-token-2',
        },
      ],
    })
    mocks.presign.mockImplementation(
      async ({ sourceToken }: { sourceToken: string }) => ({
        uploadUrl: `https://uploads.example.com/${sourceToken}`,
        stagedToken: sourceToken.replace('source-token', 'staged-token'),
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        if (url.endsWith('/imports/documents/file')) {
          return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          })
        }
        return new Response(null, {
          status: url.endsWith('source-token-1') ? 200 : 500,
        })
      }),
    )

    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: /1 document could not be recovered/i,
      }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: /continue with missing documents/i,
      }),
    )

    expect(onContinue).toHaveBeenCalledWith({
      stagedTokens: ['staged-token-1'],
      recoveredCount: 1,
      skippedCount: 1,
      skippedEntirely: false,
    })
  })

  it('keeps a total discovery failure inline until retry or skip', async () => {
    const user = userEvent.setup()
    const onContinue = renderStep()
    mocks.discover.mockRejectedValue(new Error('spliit.app is unavailable'))

    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /spliit.app is unavailable/i,
    )
    await user.click(
      screen.getByRole('button', { name: /^continue without documents$/i }),
    )
    expect(onContinue).toHaveBeenCalledWith({
      stagedTokens: [],
      recoveredCount: 0,
      skippedCount: 0,
      skippedEntirely: true,
    })
  })
})
