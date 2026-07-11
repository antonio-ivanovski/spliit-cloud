import { render, screen } from '@/test/test-utils'
import type { NormalizedSource } from '@spliit/domain/import'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useGroupsQuery: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      groups: {
        useQuery: mocks.useGroupsQuery,
      },
    },
  },
}))

vi.mock('@/components/group-form', () => ({
  GroupForm: () => null,
}))

vi.mock('./wizard-nav', () => ({
  WizardNav: () => null,
}))

import { DestinationStep } from './destination-step'

const source: NormalizedSource = {
  provider: 'SPLIIT',
  sourceGroupId: 'source-group',
  sourceUrl: null,
  name: 'Imported trip',
  currency: '€',
  currencyCode: 'EUR',
  participants: [],
  expenses: [],
}

describe('DestinationStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useGroupsQuery.mockReturnValue({
      isLoading: false,
      data: {
        groups: [
          {
            id: 'regular-group',
            name: 'Regular group',
            groupType: 'GROUP',
            currentMemberRole: 'ADMIN',
            _count: { members: 3 },
          },
          {
            id: 'friend-group',
            name: 'Friend ledger',
            groupType: 'FRIEND',
            currentMemberRole: 'ADMIN',
            _count: { members: 2 },
          },
          {
            id: 'member-group',
            name: 'Member-only group',
            groupType: 'GROUP',
            currentMemberRole: 'MEMBER',
            _count: { members: 4 },
          },
        ],
      },
    })
  })

  it('shows admin regular groups but not friend ledgers as destinations', () => {
    render(
      <DestinationStep
        source={source}
        initialGroupFormValues={{
          name: '',
          information: '',
          currency: '',
          currencyCode: '',
        }}
        mode="EXISTING_GROUP"
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    expect(screen.getByText('Regular group')).toBeInTheDocument()
    expect(screen.queryByText('Friend ledger')).not.toBeInTheDocument()
    expect(screen.queryByText('Member-only group')).not.toBeInTheDocument()
  })
})
