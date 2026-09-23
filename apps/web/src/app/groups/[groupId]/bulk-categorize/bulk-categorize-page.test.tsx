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
vi.mock('./bulk-categorize-paged-review', () => ({
  BulkCategorizePagedReview: () => <div data-testid="paged-review" />,
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
      revision: 1,
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
      revision: 1,
    })
  })

  it('shows persisted completion on a fresh visit', () => {
    mocks.run = {
      id: 'run-1',
      status: 'DONE',
      mode: 'local',
      applied: 3,
      candidateTotal: 3,
      suggestions: [],
    }

    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

    expect(screen.getByText('Categorization complete')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Start a new run' }),
    ).toBeInTheDocument()
  })

  it('shows completion when no uncategorized expenses remain', () => {
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

    expect(screen.getByText('Categorization complete')).toBeInTheDocument()
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
    expect(screen.getByText('Calibration round 1')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Preparing')
  })

  it('uses the progress panel between calibration rounds', () => {
    mocks.run = {
      id: 'run-2',
      status: 'QUEUED_CALIBRATION',
      mode: 'jev',
      round: 1,
      total: 12,
      processed: 0,
      candidateTotal: 50,
      calibration: { sample: [], confirmed: [], metrics: [] },
    }
    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)
    expect(screen.getByText('Calibration round 2')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
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

  it('shows the same progress panel as soon as a run starts', async () => {
    mocks.start.mockImplementationOnce(() => new Promise(() => {}))
    const user = userEvent.setup()
    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

    await user.click(screen.getByRole('button', { name: 'Start categorizing' }))
    expect(screen.getByText('Calibration round 1')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows pending progress immediately when confirming a calibration round', async () => {
    mocks.run = {
      id: 'run-4',
      status: 'CALIBRATION_REVIEW',
      revision: 2,
      round: 1,
      candidateTotal: 20,
      calibration: { sample: [], confirmed: [], metrics: [] },
    }
    mocks.confirm.mockImplementationOnce(() => new Promise(() => {}))
    const user = userEvent.setup()
    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

    await user.click(screen.getByRole('button', { name: 'Confirm round' }))
    expect(screen.getByText('Preparing the next step')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it.each([
    { status: 'QUEUED', processed: 0, total: 20 },
    { status: 'QUEUED_RERUN', processed: 0, total: 8 },
  ])(
    'uses a spinner while $status is queued',
    ({ status, processed, total }) => {
      mocks.run = {
        id: 'run-progress',
        status,
        mode: 'jev',
        processed,
        total,
        candidateTotal: 20,
      }

      render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Preparing')
    },
  )

  it.each([
    { status: 'PROCESSING', processed: 0, total: 20, width: '0%' },
    { status: 'PROCESSING', processed: 5, total: 20, width: '25%' },
    { status: 'RERUNNING', processed: 6, total: 8, width: '75%' },
  ])(
    'shows accurate $status progress at $processed of $total',
    ({ status, processed, total, width }) => {
      mocks.run = {
        id: 'run-progress',
        status,
        mode: 'jev',
        processed,
        total,
        candidateTotal: 20,
      }

      render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

      const progressbar = screen.getByRole('progressbar')
      expect(progressbar).toHaveAttribute(
        'aria-valuenow',
        String((100 * processed) / total),
      )
      expect(
        progressbar.querySelector('[data-slot="progress-indicator"]'),
      ).toHaveStyle({
        width,
      })
    },
  )

  it('offers General filtering and keeps rerun details in a footer popover', async () => {
    mocks.run = {
      id: 'run-5',
      status: 'REVIEW',
      revision: 3,
      mode: 'jev',
      candidateTotal: 10,
      selected: 7,
      reviewCycle: 'attempt-1',
      rerunCandidates: { general: 2, uncertain: 1 },
      feedback: {
        proposedCount: 8,
        changedCount: 2,
        assignedCount: 1,
        hasNewCorrection: true,
        hasCorrections: true,
      },
    }
    const user = userEvent.setup()
    render(<BulkCategorizePage groupId="group-1" groupName="Trip" />)

    const general = screen.getByRole('button', { name: 'General 3' })
    await user.click(general)
    expect(general).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: 'Improve remaining suggestions' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'About improving suggestions' }),
    )
    expect(
      screen.getByText('You changed 2 of 8 suggested categories.'),
    ).toBeInTheDocument()
  })
})
