import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

import { InviteCard } from './invite-card'

const mocks = vi.hoisted(() => ({
  friendsQuery: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      friends: {
        useQuery: mocks.friendsQuery,
      },
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.friendsQuery.mockReturnValue({
    data: { friends: [] },
    isLoading: false,
  })
})

function renderCard(
  overrides: Partial<ComponentProps<typeof InviteCard>> = {},
) {
  return render(
    <InviteCard
      groupId="grp-1"
      groupName="Roadtrip"
      canInviteAdmin
      createMutation={{ isPending: false }}
      createLinkMutation={{ isPending: false }}
      createParticipantMutation={{ isPending: false }}
      onInvite={vi.fn().mockResolvedValue(true)}
      onGenerateLink={vi.fn().mockResolvedValue(undefined)}
      onAddParticipant={vi.fn().mockResolvedValue(true)}
      {...overrides}
    />,
  )
}

describe('InviteCard responsive navigation', () => {
  it('uses one compact selector for the four add-person paths', async () => {
    const { user } = renderCard()

    const selector = screen.getByRole('combobox', { name: 'Add people' })
    expect(selector).toHaveTextContent('Email')
    expect(screen.getByRole('tab', { name: 'No account' })).toBeInTheDocument()

    await user.click(selector)
    await user.click(screen.getByRole('option', { name: 'No account' }))

    expect(
      screen.getByText(/without inviting them to Spliit/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Temporary name' }),
    ).toBeInTheDocument()
  })

  it('keeps an unlinked-participant draft when a guarded submit is ignored', async () => {
    const onAddParticipant = vi.fn().mockResolvedValue(false)
    const { user } = renderCard({ onAddParticipant })

    await user.click(screen.getByRole('tab', { name: 'No account' }))
    const name = screen.getByRole('textbox', { name: 'Temporary name' })
    await user.type(name, 'Charlie')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    await vi.waitFor(() => expect(onAddParticipant).toHaveBeenCalledOnce())
    expect(name).toHaveValue('Charlie')
  })

  it('keeps a link draft when a guarded submit is ignored', async () => {
    const onGenerateLink = vi.fn().mockResolvedValue(undefined)
    const { user } = renderCard({ onGenerateLink })

    await user.click(screen.getByRole('tab', { name: 'Invite link' }))
    const name = screen.getByRole('textbox', {
      name: 'Temporary name (optional)',
    })
    await user.type(name, 'Charlie')
    await user.click(
      screen.getByRole('button', { name: 'Generate invite link' }),
    )

    await vi.waitFor(() => expect(onGenerateLink).toHaveBeenCalledOnce())
    expect(name).toHaveValue('Charlie')
  })
})
