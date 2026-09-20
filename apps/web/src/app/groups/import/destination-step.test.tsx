import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GroupFormValues } from '@/lib/schemas'
import { render, screen } from '@/test/test-utils'
import type { NormalizedSource } from '@spliit/domain/import'

const mocks = vi.hoisted(() => ({
  useGroupsQuery: vi.fn(),
  groupFormProps: null as null | {
    hideAppearance?: boolean
    initialValues?: Record<string, unknown>
    onSubmit: (values: GroupFormValues) => Promise<void>
  },
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
  GroupForm: (props: {
    hideAppearance?: boolean
    initialValues?: Record<string, unknown>
    onSubmit: (values: GroupFormValues) => Promise<void>
  }) => {
    mocks.groupFormProps = props
    return (
      <button
        type="button"
        data-testid="mock-group-submit"
        onClick={() =>
          props.onSubmit({
            name: 'Picked group',
            information: '',
            currency: '€',
            currencyCode: 'EUR',
            emoji: '🎉',
            color: 'teal',
            participants: [{ name: 'Owner' }],
          })
        }
      >
        submit
      </button>
    )
  },
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
    mocks.groupFormProps = null
    mocks.useGroupsQuery.mockReturnValue({
      isLoading: false,
      data: {
        groups: [
          {
            id: 'regular-group',
            name: 'Regular group',
            displayName: 'Regular group',
            information: null,
            archived: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            groupType: 'GROUP',
            emoji: '🍻',
            color: 'teal',
            ledger: { currency: '€', currencyCode: 'EUR' },
            currentMemberRole: 'ADMIN',
            memberCount: 3,
            preference: { starred: false, hidden: false },
            friendAccount: null,
            memberAccounts: [],
          },
          {
            id: 'friend-group',
            name: 'Friend ledger',
            displayName: 'Friend ledger',
            information: null,
            archived: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            groupType: 'FRIEND',
            emoji: null,
            color: null,
            ledger: { currency: '€', currencyCode: 'EUR' },
            currentMemberRole: 'ADMIN',
            memberCount: 2,
            preference: { starred: false, hidden: false },
            friendAccount: null,
            memberAccounts: [],
          },
          {
            id: 'member-group',
            name: 'Member-only group',
            displayName: 'Member-only group',
            information: null,
            archived: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            groupType: 'GROUP',
            emoji: null,
            color: null,
            ledger: { currency: '€', currencyCode: 'EUR' },
            currentMemberRole: 'MEMBER',
            memberCount: 4,
            preference: { starred: false, hidden: false },
            friendAccount: null,
            memberAccounts: [],
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

  it('renders existing groups as selectable cards with their appearance', () => {
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

    const card = screen.getByRole('button', { name: /Regular group/ })
    // Emoji rail + member count come from the shared home card.
    expect(card).toHaveTextContent('🍻')
    expect(card).toHaveTextContent('3')
    // No balance line in the picker.
    expect(card).not.toHaveTextContent('Balances')
  })

  it('selects the existing group on click and keyboard', async () => {
    const onContinue = vi.fn()
    const { user } = render(
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
        onContinue={onContinue}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Regular group/ }))
    expect(onContinue).toHaveBeenCalledWith({
      mode: 'EXISTING_GROUP',
      targetGroupId: 'regular-group',
      groupFormValues: {
        name: '',
        information: '',
        currency: '',
        currencyCode: '',
      },
    })

    onContinue.mockClear()
    const card = screen.getByRole('button', { name: /Regular group/ })
    card.focus()
    await user.keyboard('{Enter}')
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'EXISTING_GROUP',
        targetGroupId: 'regular-group',
      }),
    )
  })

  it('shows the appearance picker for new groups and forwards picks', async () => {
    const onContinue = vi.fn()
    const { user } = render(
      <DestinationStep
        source={source}
        initialGroupFormValues={{
          name: 'Imported trip',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
          emoji: '🍻',
          color: 'teal',
        }}
        mode="NEW_GROUP"
        onBack={vi.fn()}
        onContinue={onContinue}
      />,
    )

    // The inline picker is visible (not hidden) and the full prefill contract
    // is forwarded verbatim.
    expect(mocks.groupFormProps?.hideAppearance).toBe(false)
    expect(mocks.groupFormProps?.initialValues).toEqual({
      name: 'Imported trip',
      information: '',
      currency: '€',
      currencyCode: 'EUR',
      emoji: '🍻',
      color: 'teal',
    })

    await user.click(screen.getByTestId('mock-group-submit'))
    expect(onContinue).toHaveBeenCalledWith({
      mode: 'NEW_GROUP',
      targetGroupId: null,
      groupFormValues: expect.objectContaining({ emoji: '🎉', color: 'teal' }),
    })
  })

  it('forwards explicit-none appearance to the new-group form untouched', () => {
    render(
      <DestinationStep
        source={source}
        initialGroupFormValues={{
          name: 'Imported trip',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
          emoji: '',
          color: null,
        }}
        mode="NEW_GROUP"
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    // `''` and `null` mean "none" and must not be coerced to undefined.
    expect(mocks.groupFormProps?.initialValues).toEqual({
      name: 'Imported trip',
      information: '',
      currency: '€',
      currencyCode: 'EUR',
      emoji: '',
      color: null,
    })
  })

  it('hides the appearance picker when hideAppearance is set', () => {
    render(
      <DestinationStep
        source={source}
        initialGroupFormValues={{
          name: '',
          information: '',
          currency: '',
          currencyCode: '',
        }}
        mode="NEW_GROUP"
        hideAppearance
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    expect(mocks.groupFormProps?.hideAppearance).toBe(true)
  })
})
