import { ForceArchiveDialog } from '@/components/force-archive-dialog'
import { render, screen, waitFor } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn()
const mockInvalidateAccountGroups = vi.fn()
const mockInvalidateGroupsGet = vi.fn()
const mockToast = vi.fn()
const mockPush = vi.fn()

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      archive: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
        }),
      },
    },
    useUtils: () => ({
      account: {
        groups: {
          invalidate: mockInvalidateAccountGroups,
        },
      },
      groups: {
        get: {
          invalidate: mockInvalidateGroupsGet,
        },
      },
    }),
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}))

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
}))

// ── Tests ───────────────────────────────────────────────────────────────

describe('ForceArchiveDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when groupId is null', () => {
    const { container } = render(
      <ForceArchiveDialog groupId={null} onClose={vi.fn()} />,
    )
    // The component returns null, so the container should be empty
    expect(container.innerHTML).toBe('')
  })

  it('renders a dialog with title and description when groupId is set', () => {
    render(<ForceArchiveDialog groupId="group-1" onClose={vi.fn()} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /unsettled balances/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/this group has unsettled balances/i),
    ).toBeInTheDocument()
  })

  it('has "view balances" and "force archive" action buttons', () => {
    render(<ForceArchiveDialog groupId="group-1" onClose={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /view balances/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /force archive/i }),
    ).toBeInTheDocument()
  })

  it('dialog closes when clicking cancel', async () => {
    const onClose = vi.fn()
    const { user } = render(
      <ForceArchiveDialog groupId="group-1" onClose={onClose} />,
    )

    // Dialog should be open
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Click the Cancel button
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls archive mutation and invalidates queries on force archive', async () => {
    mockMutateAsync.mockResolvedValue(undefined)
    mockInvalidateAccountGroups.mockResolvedValue(undefined)
    mockInvalidateGroupsGet.mockResolvedValue(undefined)
    const onClose = vi.fn()

    const { user } = render(
      <ForceArchiveDialog groupId="group-1" onClose={onClose} />,
    )

    await user.click(screen.getByRole('button', { name: /force archive/i }))

    expect(mockMutateAsync).toHaveBeenCalledWith({
      groupId: 'group-1',
      archived: true,
      force: true,
    })

    await waitFor(() => {
      expect(mockInvalidateAccountGroups).toHaveBeenCalledTimes(1)
    })
    expect(mockInvalidateGroupsGet).toHaveBeenCalledWith({ groupId: 'group-1' })
    expect(mockToast).toHaveBeenCalledWith({
      description: 'Settlement expenses created and group archived.',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows error toast when force archive fails', async () => {
    const error = new Error('Network error')
    mockMutateAsync.mockRejectedValue(error)
    const onClose = vi.fn()

    const { user } = render(
      <ForceArchiveDialog groupId="group-1" onClose={onClose} />,
    )

    await user.click(screen.getByRole('button', { name: /force archive/i }))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        description: 'Network error',
        variant: 'destructive',
      })
    })
    // onClose should not be called on error
    expect(onClose).not.toHaveBeenCalled()
  })

  it('navigates to balances page on view balances click', async () => {
    const onClose = vi.fn()
    const { user } = render(
      <ForceArchiveDialog groupId="group-1" onClose={onClose} />,
    )

    await user.click(screen.getByRole('button', { name: /view balances/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith({
      to: '/groups/$groupId/balances',
      params: { groupId: 'group-1' },
    })
  })
})
