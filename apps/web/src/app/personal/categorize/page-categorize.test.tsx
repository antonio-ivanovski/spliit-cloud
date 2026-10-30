import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, userEvent } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  run: null as unknown,
  uncategorizedCount: 2,
  countRefetch: vi.fn(async () => undefined),
  statusRefetch: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
  edit: vi.fn(async () => undefined),
  save: vi.fn(async () => ({ applied: 2, skipped: 0 })),
  retry: vi.fn(async () => undefined),
  discard: vi.fn(async () => undefined),
  confirm: vi.fn(async () => undefined),
  rerun: vi.fn(async () => undefined),
  saveConflictsFetch: vi.fn(async () => []),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      personal: {
        categorization: {
          saveConflicts: { fetch: mocks.saveConflictsFetch },
        },
      },
    }),
    features: {
      get: {
        useQuery: () => ({
          data: {
            bulkCategorizeSystemOneAvailable: true,
            aiMinConfidence: 0.5,
          },
        }),
      },
    },
    personal: {
      categorization: {
        count: {
          useQuery: () => ({
            data: mocks.uncategorizedCount,
            isError: false,
            isFetching: false,
            isLoading: false,
            isSuccess: true,
            refetch: mocks.countRefetch,
          }),
        },
        status: {
          useQuery: () => ({
            data: mocks.run,
            refetch: mocks.statusRefetch,
          }),
        },
        start: {
          useMutation: () => ({ mutateAsync: mocks.start, isPending: false }),
        },
        edit: {
          useMutation: () => ({ mutateAsync: mocks.edit, isPending: false }),
        },
        save: {
          useMutation: () => ({ mutateAsync: mocks.save, isPending: false }),
        },
        retry: {
          useMutation: () => ({ mutateAsync: mocks.retry, isPending: false }),
        },
        discard: {
          useMutation: () => ({ mutateAsync: mocks.discard, isPending: false }),
        },
        confirm: {
          useMutation: () => ({ mutateAsync: mocks.confirm, isPending: false }),
        },
        rerun: {
          useMutation: () => ({ mutateAsync: mocks.rerun, isPending: false }),
        },
      },
    },
  },
}))

vi.mock('@/app/groups/[groupId]/bulk-categorize/bulk-categorize-table', () => ({
  BulkCategorizeTable: () => <div data-testid="categorize-table" />,
}))

vi.mock('./personal-categorize-paged-review', () => ({
  PersonalCategorizePagedReview: () => <div data-testid="paged-review" />,
}))

import { PersonalCategorizePage } from './page-categorize'

describe('PersonalCategorizePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run = null
    mocks.uncategorizedCount = 2
    mocks.save.mockResolvedValue({ applied: 2, skipped: 0 })
  })

  it('shows the empty state when nothing is uncategorized', () => {
    mocks.uncategorizedCount = 0
    render(<PersonalCategorizePage />)
    expect(
      screen.getByText('All personal expenses already have a category.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start categorizing' }),
    ).not.toBeInTheDocument()
  })

  it('shows success after a successful save during the current visit', async () => {
    mocks.run = {
      id: 'run-1',
      status: 'REVIEW',
      mode: 'local',
      revision: 1,
      candidateTotal: 2,
      selected: 2,
      reviewCycle: 'attempt-1',
      rerunCandidates: { general: 0, uncertain: 0 },
    }
    const user = userEvent.setup()
    render(<PersonalCategorizePage />)
    await user.click(screen.getByRole('button', { name: 'Save 2 categories' }))
    expect(
      await screen.findByText('Categorization complete'),
    ).toBeInTheDocument()
    expect(mocks.save).toHaveBeenCalledWith({
      runId: 'run-1',
      revision: 1,
      skipExpenseIds: [],
    })
  })

  it('keeps a failed run available for retry', () => {
    mocks.run = {
      id: 'run-3',
      status: 'FAILED_FULL',
      mode: 'local',
      error: 'Temporary categorizer error',
      candidateTotal: 3,
    }
    render(<PersonalCategorizePage />)
    expect(screen.getByText(/Temporary categorizer error/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
