import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fireEvent, render, screen, waitFor } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  listQuery: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  invalidateComments: vi.fn(),
  invalidateActivities: vi.fn(),
  useCurrentGroup: vi.fn(),
  useIsReadOnlyGroupViewer: vi.fn(),
  useLinkInviteToken: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      groups: {
        expenses: {
          comments: { list: { invalidate: mocks.invalidateComments } },
        },
        activities: { list: { invalidate: mocks.invalidateActivities } },
      },
    }),
    groups: {
      expenses: {
        comments: {
          list: { useQuery: mocks.listQuery },
          create: {
            useMutation: () => ({
              mutateAsync: mocks.createComment,
              isPending: false,
              error: null,
            }),
          },
          delete: {
            useMutation: () => ({
              mutateAsync: mocks.deleteComment,
              isPending: false,
              error: null,
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: mocks.useCurrentGroup,
  useIsReadOnlyGroupViewer: mocks.useIsReadOnlyGroupViewer,
}))

vi.mock('@/app/groups/[groupId]/use-link-invite-token', () => ({
  useLinkInviteToken: mocks.useLinkInviteToken,
}))

import { ExpenseComments } from '../expense-comments'

const comment = {
  id: 'comment-1',
  body: 'Bring the receipt next time.',
  createdAt: new Date('2026-07-27T09:00:00.000Z'),
  author: {
    accountId: 'account-1',
    name: 'Alex',
    image: null,
  },
  canDelete: true,
}

describe('ExpenseComments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCurrentGroup.mockReturnValue({
      group: { archived: false },
      currentMember: { id: 'member-1' },
    })
    mocks.useIsReadOnlyGroupViewer.mockReturnValue(false)
    mocks.useLinkInviteToken.mockReturnValue('invite-token')
    mocks.listQuery.mockReturnValue({
      data: { comments: [comment] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    mocks.createComment.mockResolvedValue({})
    mocks.deleteComment.mockResolvedValue({})
    mocks.invalidateComments.mockResolvedValue(undefined)
    mocks.invalidateActivities.mockResolvedValue(undefined)
  })

  it('lists comments and submits a draft, invalidating the exact list and activities', async () => {
    const user = userEvent.setup()
    render(<ExpenseComments groupId="group-1" expenseId="expense-1" />)

    expect(screen.getByText('Bring the receipt next time.')).toBeInTheDocument()
    const input = screen.getByRole('textbox')
    await user.type(input, 'Dinner was great')
    await user.click(screen.getByRole('button', { name: 'Send comment' }))

    await waitFor(() =>
      expect(mocks.createComment).toHaveBeenCalledWith({
        groupId: 'group-1',
        expenseId: 'expense-1',
        body: 'Dinner was great',
        requestId: expect.any(String),
      }),
    )
    expect(mocks.invalidateComments).toHaveBeenCalledWith({
      groupId: 'group-1',
      expenseId: 'expense-1',
      linkInviteToken: 'invite-token',
    })
    expect(mocks.invalidateActivities).toHaveBeenCalledWith({
      groupId: 'group-1',
      linkInviteToken: 'invite-token',
    })
    expect(input).toHaveValue('')
  })

  it('submits from the keyboard and keeps the composer compact', async () => {
    const user = userEvent.setup()
    render(<ExpenseComments groupId="group-1" expenseId="expense-1" />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('enterkeyhint', 'send')
    expect(input).toHaveAttribute('maxlength', '500')
    expect(input).toHaveAttribute('type', 'text')

    await user.type(input, 'Sent with Enter')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(mocks.createComment).toHaveBeenCalledWith({
        groupId: 'group-1',
        expenseId: 'expense-1',
        body: 'Sent with Enter',
        requestId: expect.any(String),
      }),
    )
  })

  it('rejects drafts over the 500 character limit without sending', async () => {
    const user = userEvent.setup()
    render(<ExpenseComments groupId="group-1" expenseId="expense-1" />)

    const input = screen.getByRole('textbox')
    // happy-dom enforces HTML maxlength on value assignment; drop it so we
    // can exercise the JS length guard that still runs on submit.
    input.removeAttribute('maxLength')
    fireEvent.change(input, { target: { value: 'x'.repeat(501) } })
    await user.click(screen.getByRole('button', { name: 'Send comment' }))

    expect(mocks.createComment).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Comments must be 500 characters or fewer.',
    )
  })

  it('keeps the draft when creating a comment fails', async () => {
    mocks.createComment.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    render(<ExpenseComments groupId="group-1" expenseId="expense-1" />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Send comment' }))

    await waitFor(() => expect(mocks.createComment).toHaveBeenCalled())
    expect(input).toHaveValue('Keep this draft')
  })

  it('shows comments to pending or archived viewers without a composer', () => {
    mocks.useIsReadOnlyGroupViewer.mockReturnValue(true)
    render(<ExpenseComments groupId="group-1" expenseId="expense-1" />)
    expect(screen.getByText('Bring the receipt next time.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    mocks.useIsReadOnlyGroupViewer.mockReturnValue(false)
    mocks.useCurrentGroup.mockReturnValue({
      group: { archived: true },
      currentMember: { id: 'member-1' },
    })
    render(<ExpenseComments groupId="group-1" expenseId="expense-1" />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('only renders delete controls for comments marked deletable', async () => {
    mocks.listQuery.mockReturnValue({
      data: {
        comments: [comment, { ...comment, id: 'comment-2', canDelete: false }],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    const user = userEvent.setup()
    render(<ExpenseComments groupId="group-1" expenseId="expense-1" />)
    expect(
      screen.getAllByRole('button', { name: 'Delete comment' }),
    ).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Delete comment' }))
    await waitFor(() =>
      expect(mocks.deleteComment).toHaveBeenCalledWith({
        groupId: 'group-1',
        expenseId: 'expense-1',
        commentId: 'comment-1',
      }),
    )
  })
})
