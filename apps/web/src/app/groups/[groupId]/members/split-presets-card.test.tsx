import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OfflineHookResult } from '@/lib/offline/read-hooks'
import { render, screen } from '@/test/test-utils'

import { SplitPresetsCard } from './split-presets-card'

const mocks = vi.hoisted(() => ({
  mockPresetsListQuery: vi.fn(),
  mockUseOfflineSplitPresets: vi.fn(
    (): OfflineHookResult<{
      presets: unknown
      canManageShared: boolean
      canManagePersonal: boolean
      groupDefaults: unknown
      personalDefaults: unknown
      effectiveDefaults: unknown
      dirtySince: Date | null
    }> => ({
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: null,
        availability: 'missing',
        refreshing: false,
        incompleteGroupCount: 0,
      },
    }),
  ),
}))

vi.mock('@/lib/offline/read-hooks', () => ({
  useOfflineSplitPresets: mocks.mockUseOfflineSplitPresets,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      splitPresets: {
        list: { useQuery: mocks.mockPresetsListQuery },
        create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        update: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        delete: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        setGroupDefault: { useMutation: () => ({ mutateAsync: vi.fn() }) },
        setPersonalDefault: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      },
    },
    useUtils: () => ({
      groups: { splitPresets: { list: { invalidate: vi.fn() } } },
    }),
  },
}))

const group = {
  currency: '$',
  currencyCode: 'USD',
  participants: [{ id: 'lp-1', name: 'Alice' }],
}

const preset = {
  id: 'preset-1',
  name: 'Even split',
  scope: 'SHARED',
  ownerAccountId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  target: 'PAID_FOR',
  splitMode: 'EVENLY',
  participants: [{ participant: 'lp-1', shares: 1 }],
}

function onlinePresets() {
  return {
    presets: [preset],
    canManageShared: true,
    canManagePersonal: true,
    groupDefaults: { paidByPresetId: null, paidForPresetId: null },
    personalDefaults: {
      paidBy: { mode: 'INHERIT', presetId: null },
      paidFor: { mode: 'INHERIT', presetId: null },
    },
    effectiveDefaults: { paidByPresetId: null, paidForPresetId: null },
  }
}

describe('SplitPresetsCard offline read-only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockUseOfflineSplitPresets.mockReturnValue({
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: null,
        availability: 'missing',
        refreshing: false,
        incompleteGroupCount: 0,
      },
    })
    mocks.mockPresetsListQuery.mockReturnValue({
      data: onlinePresets(),
      isLoading: false,
    })
  })

  it('renders presets with management online', () => {
    render(
      <SplitPresetsCard
        groupId="grp-1"
        group={group as never}
        canManage={true}
        isArchived={false}
      />,
    )

    expect(screen.getByText('Even split')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create preset' }),
    ).toBeInTheDocument()
  })

  it('renders downloaded presets read-only while offline', () => {
    mocks.mockPresetsListQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    })
    mocks.mockUseOfflineSplitPresets.mockReturnValue({
      data: {
        presets: [preset],
        canManageShared: true,
        canManagePersonal: true,
        groupDefaults: { paidByPresetId: null, paidForPresetId: null },
        personalDefaults: {
          paidBy: { mode: 'INHERIT', presetId: null },
          paidFor: { mode: 'INHERIT', presetId: null },
        },
        effectiveDefaults: { paidByPresetId: null, paidForPresetId: null },
        dirtySince: null,
      },
      meta: {
        source: 'download',
        capturedAt: new Date('2026-07-01T00:00:00Z'),
        availability: 'ready',
        refreshing: false,
        incompleteGroupCount: 0,
      },
    })
    render(
      <SplitPresetsCard
        groupId="grp-1"
        group={group as never}
        canManage={true}
        isArchived={false}
      />,
    )

    expect(screen.getByText('Even split')).toBeInTheDocument()
    expect(screen.getByText('Reconnect to make changes')).toBeInTheDocument()
    // Creation and per-preset actions stay hidden offline.
    expect(
      screen.queryByRole('button', { name: 'Create preset' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Preset actions' }),
    ).not.toBeInTheDocument()
  })
})
