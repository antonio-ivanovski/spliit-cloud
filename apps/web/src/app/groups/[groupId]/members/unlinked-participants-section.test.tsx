import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

import { UnlinkedParticipantsSection } from './unlinked-participants-section'

const mocks = vi.hoisted(() => ({
  listUnlinked: vi.fn(),
  onRemove: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      importLinks: {
        listUnlinked: { useQuery: mocks.listUnlinked },
      },
    },
  },
}))

vi.mock('./link-unlinked-participant-dialog', () => ({
  LinkUnlinkedParticipantDialog: ({
    open,
    finalFocusRef,
  }: {
    open: boolean
    finalFocusRef?: { current: HTMLButtonElement | null }
  }) =>
    open ? (
      <div>
        <p>Link participant dialog</p>
        <p>Return to {finalFocusRef?.current?.getAttribute('aria-label')}</p>
      </div>
    ) : null,
}))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  window.localStorage.removeItem('group-members-unlinked-grp-1')
  mocks.listUnlinked.mockReturnValue({
    data: {
      unlinked: [{ id: 'lp-unlinked', displayName: 'Roommate' }],
    },
    isLoading: false,
  })
})

function mockViewport(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

describe('UnlinkedParticipantsSection row actions', () => {
  it('leaves breathing room above the section divider', () => {
    render(
      <UnlinkedParticipantsSection
        groupId="grp-1"
        canManage
        onRemove={mocks.onRemove}
      />,
    )

    expect(
      screen
        .getByRole('button', { name: /Participants without accounts/ })
        .closest('.mt-4'),
    ).toBeInTheDocument()
  })

  it('shows right-aligned icon actions with accessible labels', async () => {
    mockViewport(true)
    const { user } = render(
      <UnlinkedParticipantsSection
        groupId="grp-1"
        canManage
        onRemove={mocks.onRemove}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /Participants without accounts/ }),
    )

    expect(screen.getByRole('button', { name: 'Link' })).toHaveAttribute(
      'title',
      'Link',
    )
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute(
      'title',
      'Remove',
    )
    expect(
      screen.queryByText('Link', { selector: 'button' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Remove', { selector: 'button' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the remove callback unchanged', async () => {
    mockViewport(true)
    const { user } = render(
      <UnlinkedParticipantsSection
        groupId="grp-1"
        canManage
        onRemove={mocks.onRemove}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /Participants without accounts/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(mocks.onRemove).toHaveBeenCalledWith({
      ledgerParticipantId: 'lp-unlinked',
      name: 'Roommate',
    })
  })

  it('uses one mobile More button and hides the technical participant id', async () => {
    mockViewport(false)
    mocks.listUnlinked.mockReturnValue({
      data: {
        unlinked: [
          { id: 'lp-unlinked', displayName: 'Roommate' },
          { id: 'lp-second', displayName: 'Travel buddy' },
        ],
      },
      isLoading: false,
    })
    const { user } = render(
      <UnlinkedParticipantsSection
        groupId="grp-1"
        canManage
        onRemove={mocks.onRemove}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /Participants without accounts/ }),
    )

    expect(screen.queryByText(/Ledger participant id/i)).not.toBeInTheDocument()
    expect(screen.queryByText('lp-unlinked')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Link' }),
    ).not.toBeInTheDocument()

    const moreButton = screen.getByRole('button', {
      name: 'Actions for Roommate',
    })
    await user.click(moreButton)
    expect(
      screen.getByRole('heading', { name: 'Actions for Roommate' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect(await screen.findByText('Link participant dialog')).toBeVisible()
    expect(
      screen.getByText('Return to Actions for Roommate'),
    ).toBeInTheDocument()
  })

  it('invokes removal from the mobile sheet and respects permissions', async () => {
    mockViewport(false)
    const { user, rerender } = render(
      <UnlinkedParticipantsSection
        groupId="grp-1"
        canManage
        onRemove={mocks.onRemove}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /Participants without accounts/ }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Actions for Roommate' }),
    )
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(mocks.onRemove).toHaveBeenCalledWith({
        ledgerParticipantId: 'lp-unlinked',
        name: 'Roommate',
      }),
    )

    rerender(
      <UnlinkedParticipantsSection
        groupId="grp-1"
        canManage={false}
        onRemove={mocks.onRemove}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Actions for Roommate' }),
    ).not.toBeInTheDocument()
  })
})
