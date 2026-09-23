import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, userEvent } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  run: null as unknown,
  uncategorizedCount: 3,
  countRefetch: vi.fn(async () => undefined),
  statusRefetch: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
  edit: vi.fn(async () => undefined),
  save: vi.fn(async () => ({ applied: 2, skipped: 0 })),
  retry: vi.fn(async () => undefined),
  discard: vi.fn(async () => undefined),
  confirm: vi.fn(async () => undefined),
  rerun: vi.fn(async () => undefined),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    features: {
      get: { useQuery: () => ({ data: { bulkCategorizeJevAvailable: true } }) },
    },
    ai: {
      bulkCategorize: {
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
        start: { useMutation: () => ({ mutateAsync: mocks.start }) },
        edit: { useMutation: () => ({ mutateAsync: mocks.edit }) },
        save: { useMutation: () => ({ mutateAsync: mocks.save }) },
        retry: { useMutation: () => ({ mutateAsync: mocks.retry }) },
        discard: { useMutation: () => ({ mutateAsync: mocks.discard }) },
        confirm: { useMutation: () => ({ mutateAsync: mocks.confirm }) },
        rerun: { useMutation: () => ({ mutateAsync: mocks.rerun }) },
      },
    },
  },
}))

vi.mock('./bulk-categorize-table', () => ({
  BulkCategorizeTable: () => <div data-testid="categorize-table" />,
}))

import { BulkCategorizePage } from './bulk-categorize-page'

describe('BulkCategorizePage completion state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run = null
    mocks.uncategorizedCount = 3
    mocks.save.mockResolvedValue({ applied: 2, skipped: 0 })
  })

  it('shows success after a successful save during the current visit', async () => {
    mocks.run = {
      id: 'run-1',
      status: 'REVIEW',
      mode: 'local',
      suggestions: [],
      candidateTotal: 2,
      rerunCandidates: { general: 0, uncertain: 0 },
    }
    const user = userEvent.setup()

    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

    await user.click(
      screen.getByRole('button', { name: 'Finish without changes' }),
    )

    expect(
      await screen.findByText('Categorization complete'),
    ).toBeInTheDocument()
    expect(mocks.save).toHaveBeenCalledWith({
      groupId: 'group-1',
      runId: 'run-1',
    })
  })

  it('shows the start view instead of a persisted completion on a fresh visit', () => {
    mocks.run = {
      id: 'run-1',
      status: 'DONE',
      mode: 'local',
      applied: 3,
      candidateTotal: 3,
      suggestions: [],
    }

    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

    expect(
      screen.queryByText('Categorization complete'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Start categorizing' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '3 expenses are currently in General and ready to review.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the empty start view when no uncategorized expenses remain', () => {
    mocks.run = {
      id: 'run-1',
      status: 'DONE',
      mode: 'local',
      applied: 3,
      candidateTotal: 3,
      suggestions: [],
    }
    mocks.uncategorizedCount = 0

    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

    expect(
      screen.getByText('There are no uncategorized expenses to categorize.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start categorizing' }),
    ).not.toBeInTheDocument()
  })

  it('keeps a pending run visible on a fresh visit', () => {
    mocks.run = {
      id: 'run-2',
      status: 'QUEUED_CALIBRATION',
      mode: 'local',
      round: 0,
      suggestions: [],
      candidateTotal: 3,
    }

    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

    expect(
      screen.queryByText('Categorization complete'),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/Preparing a varied sample/)).toBeInTheDocument()
  })

  it('keeps a failed run available for retry on a fresh visit', () => {
    mocks.run = {
      id: 'run-3',
      status: 'FAILED_FULL',
      mode: 'local',
      error: 'Temporary categorizer error',
      suggestions: [],
      candidateTotal: 3,
    }

    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

    expect(screen.getByText(/Temporary categorizer error/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
