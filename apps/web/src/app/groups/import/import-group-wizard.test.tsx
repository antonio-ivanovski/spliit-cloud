import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

const fixtures = vi.hoisted(() => ({
  routeSource: 'spliit-cloud' as const,
  account: {
    id: 'account-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  inspection: {
    kind: 'GROUP' as const,
    manifest: {
      format: 'spliit.cloud/export',
      version: 1,
      scope: { type: 'GROUP', sourceId: 'source-group-1' },
      exportedAt: '2025-01-01T00:00:00.000Z',
      complete: true,
      warnings: [],
      group: {
        sourceId: 'source-group-1',
        name: 'Trip',
        information: '',
        archived: false,
        groupType: 'GROUP',
        ledger: { currency: '€', currencyCode: 'EUR' },
      },
      participants: [
        {
          sourceId: 'participant-1',
          displayName: 'Alice',
          identity: {
            kind: 'ACCOUNT',
            accountId: 'account-1',
            name: 'Alice',
            email: 'alice@example.com',
          },
        },
      ],
      expenses: [],
      orphanDocuments: [],
      recurrenceSeries: [],
    },
    documents: new Map(),
    documentIssues: [],
  },
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => ({ source: fixtures.routeSource, prefill: undefined }),
  }),
  useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: () => ({ data: fixtures.account, isPending: false }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/trpc/client', () => {
  const invalidate = vi.fn()
  const mutation = {
    mutateAsync: vi.fn(),
    isPending: false,
    data: undefined,
  }
  return {
    trpc: {
      useUtils: () => ({
        invitations: { listForAccount: { invalidate } },
        groups: {
          get: { invalidate },
          importLinks: { listUnlinked: { invalidate } },
          balances: { list: { invalidate } },
          getDetails: { invalidate },
        },
        account: { friends: { invalidate } },
      }),
      groups: {
        get: { useQuery: () => ({ data: undefined }) },
        import: { useMutation: () => mutation },
        importCloudBundle: { useMutation: () => mutation },
      },
      account: {
        friends: { useQuery: () => ({ data: { friends: [] } }) },
      },
    },
  }
})

vi.mock('./use-import-source', () => ({
  useImportSource: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    submit: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('./wizard-nav', () => ({
  StepHeader: ({ step }: { step: string }) => (
    <div data-testid="step-header">{step}</div>
  ),
}))

vi.mock('./source-step', () => ({
  SourceStep: (props: {
    onCloudLoaded?: (inspection: typeof fixtures.inspection) => void
    retainedCloudBundle?: { onResume: () => void }
  }) => (
    <div data-testid="source-step">
      <button
        type="button"
        onClick={() => props.onCloudLoaded?.(fixtures.inspection)}
      >
        Load Cloud bundle
      </button>
      {props.retainedCloudBundle && (
        <button type="button" onClick={props.retainedCloudBundle.onResume}>
          Continue with this bundle
        </button>
      )}
    </div>
  ),
}))

vi.mock('./destination-step', () => ({
  DestinationStep: (props: { onBack: () => void }) => (
    <div data-testid="destination-step">
      Destination
      <button type="button" onClick={props.onBack}>
        Back
      </button>
    </div>
  ),
}))

vi.mock('./mapping-step', () => ({ MappingStep: () => <div>Mapping</div> }))
vi.mock('./currency-conversion-step', () => ({
  CurrencyConversionStep: () => <div>Currency conversion</div>,
}))
vi.mock('./documents-step', () => ({
  DocumentsStep: () => <div>Documents</div>,
}))
vi.mock('./confirm-step', () => ({ ConfirmStep: () => <div>Confirm</div> }))
vi.mock('./done-step', () => ({ DoneStep: () => <div>Done</div> }))

import { ImportGroupWizard } from './import-group-wizard'

describe('ImportGroupWizard Cloud retained bundle flow', () => {
  it('stays on source after back and resumes only when requested', async () => {
    const user = userEvent.setup()
    render(<ImportGroupWizard />)

    await user.click(screen.getByRole('button', { name: 'Load Cloud bundle' }))
    expect(await screen.findByTestId('destination-step')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByTestId('source-step')).toBeInTheDocument()
    expect(screen.getByTestId('step-header')).toHaveTextContent('source')
    expect(
      screen.getByRole('button', { name: 'Continue with this bundle' }),
    ).toBeInTheDocument()

    // A stale pending inspection would immediately dispatch SOURCE_LOADED
    // here and make the destination step reappear before this assertion.
    await waitFor(() =>
      expect(screen.getByTestId('step-header')).toHaveTextContent('source'),
    )

    await user.click(
      screen.getByRole('button', { name: 'Continue with this bundle' }),
    )
    expect(await screen.findByTestId('destination-step')).toBeInTheDocument()
  })
})
