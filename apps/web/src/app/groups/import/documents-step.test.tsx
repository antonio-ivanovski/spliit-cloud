import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'
import type { NormalizedSource } from '@spliit/domain/import'

import type { CloudGroupBundleInspection } from './cloud-bundle'

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
      cloudImportDocumentPresign: {
        useMutation: () => ({ mutateAsync: mocks.presign }),
      },
    },
  },
}))

vi.mock(import('@/lib/upload'), async (importOriginal) => ({
  ...(await importOriginal()),
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
      notes: null,
    },
  ],
}

function renderStep(
  onContinue = vi.fn(),
  sourceOverride: NormalizedSource = source,
) {
  render(
    <DocumentsStep
      source={sourceOverride}
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

  it('keeps the legacy description for spliit.app imports', () => {
    renderStep()
    expect(
      screen.getByText(
        /Spliit Cloud can securely copy receipt images from the original spliit\.app group/i,
      ),
    ).toBeInTheDocument()
  })

  it('prepares embedded empty document arrays without requesting discovery metadata', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    mocks.discover.mockResolvedValue({ failures: [], documents: [] })
    renderStep(onContinue, {
      ...source,
      exportVersion: 3,
      documentSource: 'EMBEDDED',
      expenses: source.expenses.map((expense) => ({
        ...expense,
        sourceDocuments: [],
      })),
    })

    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )

    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        exportVersion: 3,
        expenses: [expect.objectContaining({ sourceDocuments: [] })],
      }),
    )
    expect(onContinue).toHaveBeenCalledWith({
      stagedTokens: [],
      recoveredCount: 0,
      skippedCount: 0,
      skippedEntirely: false,
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

  it('stages Cloud bytes through the shared document UI without resizing', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    const cloudOnContinue = vi.fn()
    const bytes = new Uint8Array([1, 2, 3, 4])
    const document = {
      sourceId: 'doc-1',
      fileName: 'receipt.bin',
      contentType: 'application/octet-stream',
      width: null,
      height: null,
      path: 'documents/expense-1/doc-1__receipt.bin',
      status: 'INCLUDED' as const,
      sizeBytes: bytes.byteLength,
      sha256: 'a'.repeat(64),
    }
    const inspection = {
      kind: 'GROUP' as const,
      manifest: {
        expenses: [{ documents: [document] }],
        orphanDocuments: [],
      },
      documents: new Map([['doc-1', bytes]]),
      documentIssues: [],
    } as unknown as CloudGroupBundleInspection
    mocks.presign.mockResolvedValue({
      uploadUrl: 'https://uploads.example.com/doc-1',
      stagedToken: 'staged-doc-1',
    })
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

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
        cloud={{
          inspection,
          initialDocuments: [],
          initialIssues: [],
          initialSkippedDocumentIds: [],
          onContinue: cloudOnContinue,
        }}
      />,
    )

    expect(
      screen.getByText(
        /Restore the original document files embedded in this Spliit Cloud backup/i,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', {
        name: /restore 1 document\(s\) from this backup/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/1 of 1 document\(s\) are ready to restore/i),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )

    expect(await screen.findByText(/recovered 1 document/i)).toBeInTheDocument()
    expect(onContinue).not.toHaveBeenCalled()
    expect(cloudOnContinue).toHaveBeenCalledWith({
      stagedDocuments: [
        { sourceDocumentId: 'doc-1', stagedToken: 'staged-doc-1' },
      ],
      skippedDocumentIds: [],
      acknowledgedIssues: false,
    })
    const uploadInit = fetchMock.mock.calls[0]?.[1]
    expect(uploadInit).toMatchObject({
      method: 'PUT',
      body: expect.any(Blob),
    })
    const uploadBody = uploadInit?.body
    if (!(uploadBody instanceof Blob)) throw new Error('Expected upload body')
    expect([...new Uint8Array(await uploadBody.arrayBuffer())]).toEqual([
      ...bytes,
    ])
  })

  it('shows unavailable Cloud documents eagerly and requires an explicit skip', async () => {
    const user = userEvent.setup()
    const cloudOnContinue = vi.fn()
    const inspection = {
      kind: 'GROUP' as const,
      manifest: {
        expenses: [
          {
            documents: [{ sourceId: 'doc-missing', status: 'MISSING' }],
          },
        ],
        orphanDocuments: [],
      },
      documents: new Map(),
      documentIssues: [],
    } as unknown as CloudGroupBundleInspection

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
        onContinue={vi.fn()}
        cloud={{
          inspection,
          initialDocuments: [],
          initialIssues: [
            { sourceId: 'doc-missing', path: null, message: 'Missing bytes' },
          ],
          initialSkippedDocumentIds: [],
          onContinue: cloudOnContinue,
        }}
      />,
    )

    expect(
      screen.getByText(/none of the documents in this backup are available/i),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('checkbox', {
        name: /i understand these documents will be skipped/i,
      }),
    )
    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )
    expect(cloudOnContinue).toHaveBeenCalledWith({
      stagedDocuments: [],
      skippedDocumentIds: ['doc-missing'],
      acknowledgedIssues: true,
    })
  })

  it('turns an included document with missing bytes into an explicit skip', async () => {
    const user = userEvent.setup()
    const cloudOnContinue = vi.fn()
    const document = {
      sourceId: 'doc-missing-bytes',
      fileName: 'receipt.bin',
      contentType: 'application/octet-stream',
      width: null,
      height: null,
      path: 'documents/expense-1/doc-missing-bytes__receipt.bin',
      status: 'INCLUDED' as const,
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
    }
    const inspection = {
      kind: 'GROUP' as const,
      manifest: { expenses: [{ documents: [document] }], orphanDocuments: [] },
      documents: new Map(),
      documentIssues: [],
    } as unknown as CloudGroupBundleInspection

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
        onContinue={vi.fn()}
        cloud={{
          inspection,
          initialDocuments: [],
          initialIssues: [],
          initialSkippedDocumentIds: [],
          onContinue: cloudOnContinue,
        }}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /included document bytes are missing/i,
    )
    await user.click(
      screen.getByRole('checkbox', {
        name: /i understand these documents will be skipped/i,
      }),
    )
    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )

    expect(cloudOnContinue).toHaveBeenCalledWith({
      stagedDocuments: [],
      skippedDocumentIds: ['doc-missing-bytes'],
      acknowledgedIssues: true,
    })
  })

  it('explains when a Cloud bundle has no documents and continues without staging', async () => {
    const user = userEvent.setup()
    const cloudOnContinue = vi.fn()
    const inspection = {
      kind: 'GROUP' as const,
      manifest: { expenses: [], orphanDocuments: [] },
      documents: new Map(),
      documentIssues: [],
    } as unknown as CloudGroupBundleInspection

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
        onContinue={vi.fn()}
        cloud={{
          inspection,
          initialDocuments: [],
          initialIssues: [],
          initialSkippedDocumentIds: [],
          onContinue: cloudOnContinue,
        }}
      />,
    )

    expect(
      screen.getByText(/this backup contains no documents to restore/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', {
        name: /restore .* document/i,
      }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )
    expect(cloudOnContinue).toHaveBeenCalledWith({
      stagedDocuments: [],
      skippedDocumentIds: [],
      acknowledgedIssues: true,
    })
  })

  it('aborts an in-flight Cloud staging run when navigating back', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const cloudOnContinue = vi.fn()
    const document = {
      sourceId: 'doc-1',
      fileName: 'receipt.bin',
      contentType: 'application/octet-stream',
      width: null,
      height: null,
      path: 'documents/expense-1/doc-1__receipt.bin',
      status: 'INCLUDED' as const,
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
    }
    const inspection = {
      kind: 'GROUP' as const,
      manifest: { expenses: [{ documents: [document] }], orphanDocuments: [] },
      documents: new Map([['doc-1', new Uint8Array([1])]]),
      documentIssues: [],
    } as unknown as CloudGroupBundleInspection
    mocks.presign.mockReturnValue(new Promise(() => undefined))

    render(
      <DocumentsStep
        source={source}
        sessionId="00000000-0000-4000-8000-000000000001"
        initialTokens={[]}
        initialRecoveredCount={0}
        initialSkippedCount={0}
        initialSkippedEntirely={false}
        initialCompleted={false}
        onBack={onBack}
        onContinue={vi.fn()}
        cloud={{
          inspection,
          initialDocuments: [],
          initialIssues: [],
          initialSkippedDocumentIds: [],
          onContinue: cloudOnContinue,
        }}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /continue to confirm/i }),
    )
    await user.click(
      screen.getByRole('button', { name: /back to currency conversion/i }),
    )

    expect(onBack).toHaveBeenCalledOnce()
    expect(cloudOnContinue).not.toHaveBeenCalled()
  })
})
