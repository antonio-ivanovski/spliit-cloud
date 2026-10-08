import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { SubgroupsCard } from './subgroups-card'

const mocks = vi.hoisted(() => ({
  mockSubgroupsList: vi.fn(),
  mockUseOnlineStatus: vi.fn(() => true),
  mockUseOfflineSubgroups: vi.fn(),
}))

vi.mock('@/app/groups/[groupId]/use-group-access-search', () => ({
  useGroupAccessSearch: () => ({
    linkInviteToken: undefined,
    viewKey: undefined,
  }),
}))

vi.mock('@/lib/use-online-status', () => ({
  useOnlineStatus: mocks.mockUseOnlineStatus,
}))

vi.mock('@/lib/offline/read-hooks', () => ({
  useOfflineSubgroups: mocks.mockUseOfflineSubgroups,
}))

vi.mock('@/components/mascot/mascot-context', () => ({
  useMascotController: () => ({ react: vi.fn() }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      subgroups: {
        list: { useQuery: mocks.mockSubgroupsList },
        setEnabled: { useMutation: () => ({ mutate: vi.fn() }) },
        create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        update: { useMutation: () => ({ mutate: vi.fn() }) },
        delete: { useMutation: () => ({ mutate: vi.fn() }) },
      },
    },
    useUtils: () => ({
      groups: {
        subgroups: { list: { invalidate: vi.fn() } },
        get: { invalidate: vi.fn() },
        balances: { list: { invalidate: vi.fn() } },
      },
    }),
  },
}))

const participants = [
  { id: 'lp-1', name: 'Alice', account: null, pending: false, unlinked: false },
  { id: 'lp-2', name: 'Bob', account: null, pending: false, unlinked: false },
]

const offlineSubgroups = [
  {
    id: 'sg-1',
    name: 'Trip crew',
    participantIds: ['lp-1', 'lp-2'],
  },
]

function mockOfflineReady(dirtySince: Date | null = null) {
  mocks.mockUseOfflineSubgroups.mockReturnValue({
    data: {
      enabled: true,
      subgroups: offlineSubgroups,
      dirtySince,
    },
    meta: { availability: 'ready' },
  })
}

describe('SubgroupsCard offline read-only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockUseOnlineStatus.mockReturnValue(true)
    mocks.mockUseOfflineSubgroups.mockReturnValue({
      data: undefined,
      meta: { availability: 'missing' },
    })
    mocks.mockSubgroupsList.mockReturnValue({
      data: { enabled: true, subgroups: [] },
      isLoading: false,
      isError: false,
    })
  })

  it('renders downloaded subgroups read-only while offline', () => {
    mocks.mockUseOnlineStatus.mockReturnValue(false)
    mockOfflineReady()
    mocks.mockSubgroupsList.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    })
    render(
      <SubgroupsCard
        groupId="grp-1"
        participants={participants}
        canManage={true}
      />,
    )

    expect(screen.getByText('Trip crew')).toBeInTheDocument()
    expect(screen.getByText('Alice · Bob')).toBeInTheDocument()
    expect(screen.getByText('Reconnect to make changes')).toBeInTheDocument()
    // Management affordances stay hidden offline.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('warns when the downloaded subgroups may be out of date', () => {
    mocks.mockUseOnlineStatus.mockReturnValue(false)
    mockOfflineReady(new Date('2026-01-02T00:00:00Z'))
    mocks.mockSubgroupsList.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    })
    render(
      <SubgroupsCard
        groupId="grp-1"
        participants={participants}
        canManage={true}
      />,
    )

    expect(
      screen.getByText('Some data may be out of date.'),
    ).toBeInTheDocument()
  })

  it('keeps the management UI online', () => {
    mocks.mockSubgroupsList.mockReturnValue({
      data: {
        enabled: true,
        subgroups: [
          { id: 'sg-1', name: 'Trip crew', participantIds: ['lp-1', 'lp-2'] },
        ],
      },
      isLoading: false,
      isError: false,
    })
    render(
      <SubgroupsCard
        groupId="grp-1"
        participants={participants}
        canManage={true}
      />,
    )

    expect(screen.getByRole('switch')).toBeInTheDocument()
    expect(screen.getByText('Trip crew')).toBeInTheDocument()
  })
})
