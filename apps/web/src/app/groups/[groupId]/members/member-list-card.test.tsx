import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

import { MemberListCard } from './member-list-card'

vi.mock('./unlinked-participants-section', () => ({
  UnlinkedParticipantsSection: () => null,
}))

const mocks = vi.hoisted(() => ({
  onRemove: vi.fn(),
  onUpdateRole: vi.fn(),
}))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
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

function renderCard({
  canManage = true,
  currentMemberId = 'member-1',
}: {
  canManage?: boolean
  currentMemberId?: string
} = {}) {
  return render(
    <MemberListCard
      groupId="grp-1"
      members={[
        {
          id: 'member-2',
          account: {
            id: 'account-2',
            name: 'Alex',
            email: 'alex@example.com',
            image: null,
          },
          role: 'MEMBER',
          ledgerParticipantId: 'lp-2',
          joinedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]}
      isLoading={false}
      accountId="account-1"
      currentMemberId={currentMemberId}
      canManage={canManage}
      updateRoleMutation={{ isPending: false }}
      onRemove={mocks.onRemove}
      onUpdateRole={mocks.onUpdateRole}
      roleLabels={{ ADMIN: 'Admin', MEMBER: 'Member' }}
      locale="en-US"
      timeZone="UTC"
    />,
  )
}

describe('MemberListCard row actions', () => {
  it('exposes icon-only role and remove actions with accessible names', async () => {
    mockViewport(true)
    const { user } = renderCard()

    const roleButton = screen.getByRole('combobox', { name: 'Change role' })
    expect(roleButton).toHaveAttribute('title', 'Change role')
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute(
      'title',
      'Remove',
    )
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()

    await user.click(roleButton)
    await user.click(screen.getByRole('option', { name: 'Admin' }))

    expect(mocks.onUpdateRole).toHaveBeenCalledWith('member-2', 'ADMIN')
  })

  it('keeps the remove callback unchanged', async () => {
    mockViewport(true)
    const { user } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(mocks.onRemove).toHaveBeenCalledWith({
      ledgerParticipantId: 'lp-2',
      name: 'Alex',
    })
  })

  it('uses one mobile More button with direct role choices and removal', async () => {
    mockViewport(false)
    const { user } = renderCard()

    expect(
      screen.queryByRole('combobox', { name: 'Change role' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove' }),
    ).not.toBeInTheDocument()

    const moreButton = screen.getByRole('button', {
      name: 'Actions for Alex',
    })
    await user.click(moreButton)

    expect(
      screen.getByRole('heading', { name: 'Actions for Alex' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Member' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Admin' }))
    await waitFor(() =>
      expect(mocks.onUpdateRole).toHaveBeenCalledWith('member-2', 'ADMIN'),
    )

    await user.click(moreButton)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(mocks.onRemove).toHaveBeenCalledWith({
        ledgerParticipantId: 'lp-2',
        name: 'Alex',
      }),
    )
  })

  it('does not show mobile actions without permission or on the self row', () => {
    mockViewport(false)
    const { rerender } = renderCard({ canManage: false })

    expect(
      screen.queryByRole('button', { name: 'Actions for Alex' }),
    ).not.toBeInTheDocument()

    rerender(
      <MemberListCard
        groupId="grp-1"
        members={[
          {
            id: 'member-2',
            account: { id: 'account-2', name: 'Alex', image: null },
            role: 'MEMBER',
            ledgerParticipantId: 'lp-2',
          },
        ]}
        isLoading={false}
        accountId="account-2"
        currentMemberId="member-2"
        canManage
        updateRoleMutation={{ isPending: false }}
        onRemove={mocks.onRemove}
        onUpdateRole={mocks.onUpdateRole}
        roleLabels={{ ADMIN: 'Admin', MEMBER: 'Member' }}
        locale="en-US"
        timeZone="UTC"
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Actions for Alex' }),
    ).not.toBeInTheDocument()
  })
})
