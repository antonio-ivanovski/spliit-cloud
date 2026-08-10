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

function renderCard() {
  return render(
    <InviteCard
      groupId="grp-1"
      groupName="Roadtrip"
      canInviteAdmin
      createMutation={{ isPending: false }}
      createLinkMutation={{ isPending: false }}
      createParticipantMutation={{ isPending: false }}
      onInvite={vi.fn()}
      onGenerateLink={vi.fn().mockResolvedValue(undefined)}
      onAddParticipant={vi.fn().mockResolvedValue(undefined)}
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
})
