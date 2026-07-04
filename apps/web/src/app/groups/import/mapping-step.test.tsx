import type { AuthAccount } from '@/lib/auth'
import { render, screen } from '@/test/test-utils'
import type {
  DestinationParticipant,
  NormalizedSource,
  ParticipantMappingState,
} from '@spliit/domain/import'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MappingStep } from './mapping-step'

// ── Fixtures ────────────────────────────────────────────────────────────

const account: AuthAccount = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  image: null,
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeSource(
  participants: Array<{ sourceId: string; sourceName: string }>,
): NormalizedSource {
  return {
    provider: 'SPLIIT',
    sourceGroupId: 'src-1',
    sourceUrl: null,
    name: 'Trip',
    currency: '€',
    currencyCode: 'EUR',
    participants,
    expenses: [],
  }
}

function row(
  partial: Partial<ParticipantMappingState> & {
    key: string
    sourceId: string
    sourceName: string
  },
): ParticipantMappingState {
  return {
    key: partial.key,
    source: { sourceId: partial.sourceId, sourceName: partial.sourceName },
    mode: partial.mode ?? 'INVITE_BY_EMAIL',
    linkedAccountId: partial.linkedAccountId,
    inviteEmail: partial.inviteEmail,
    existingLedgerParticipantId: partial.existingLedgerParticipantId,
  }
}

const ALL_VALID: ParticipantMappingState[] = [
  // Importer links to their own account.
  row({
    key: '0',
    sourceId: 'a',
    sourceName: 'Alice',
    mode: 'LINK_ACCOUNT',
    linkedAccountId: account.id,
  }),
  // A second participant with an invite email.
  row({
    key: '1',
    sourceId: 'b',
    sourceName: 'Bob',
    inviteEmail: 'bob@example.com',
  }),
]

const MISSING_EMAIL: ParticipantMappingState[] = [
  row({
    key: '0',
    sourceId: 'a',
    sourceName: 'Alice',
    mode: 'LINK_ACCOUNT',
    linkedAccountId: account.id,
  }),
  row({
    key: '1',
    sourceId: 'b',
    sourceName: 'Bob',
    // empty email — Continue must be disabled
    inviteEmail: '',
  }),
]

// ── Tests ───────────────────────────────────────────────────────────────

describe('MappingStep', () => {
  it('renders without throwing and shows all participant rows', () => {
    render(
      <MappingStep
        source={makeSource([
          { sourceId: 'a', sourceName: 'Alice' },
          { sourceId: 'b', sourceName: 'Bob' },
        ])}
        participants={ALL_VALID}
        account={account}
        onBack={vi.fn()}
        onChange={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('keeps the Continue button enabled when all participants are valid', () => {
    render(
      <MappingStep
        source={makeSource([])}
        participants={ALL_VALID}
        account={account}
        onBack={vi.fn()}
        onChange={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    const continueBtn = screen.getByRole('button', { name: /continue to/i })
    expect(continueBtn).not.toBeDisabled()
  })

  it('disables Continue when an invite email is missing', () => {
    render(
      <MappingStep
        source={makeSource([])}
        participants={MISSING_EMAIL}
        account={account}
        onBack={vi.fn()}
        onChange={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    const continueBtn = screen.getByRole('button', { name: /continue to/i })
    expect(continueBtn).toBeDisabled()
  })

  it('disables Continue when two rows target the same existing member', () => {
    const dup: ParticipantMappingState[] = [
      row({
        key: '0',
        sourceId: 'a',
        sourceName: 'Alice',
        mode: 'LINK_ACCOUNT',
        linkedAccountId: account.id,
      }),
      row({
        key: '1',
        sourceId: 'b',
        sourceName: 'Bob',
        mode: 'LINK_EXISTING_PARTICIPANT',
        existingLedgerParticipantId: 'lp-1',
      }),
      row({
        key: '2',
        sourceId: 'c',
        sourceName: 'Bob Jr',
        mode: 'LINK_EXISTING_PARTICIPANT',
        existingLedgerParticipantId: 'lp-1', // duplicate!
      }),
    ]
    render(
      <MappingStep
        source={makeSource([])}
        participants={dup}
        account={account}
        onBack={vi.fn()}
        onChange={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    const continueBtn = screen.getByRole('button', { name: /continue to/i })
    expect(continueBtn).toBeDisabled()
  })

  it('calls onContinue exactly once when Continue is clicked in a valid state', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    render(
      <MappingStep
        source={makeSource([])}
        participants={ALL_VALID}
        account={account}
        onBack={vi.fn()}
        onChange={vi.fn()}
        onContinue={onContinue}
      />,
    )

    const continueBtn = screen.getByRole('button', { name: /continue to/i })
    await user.click(continueBtn)

    expect(onContinue).toHaveBeenCalledOnce()
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceIdToDestId: expect.any(Object),
        destIds: expect.any(Object),
        resolvedExpenses: expect.any(Array),
      }),
    )
  })

  it('does not call onContinue when disabled', async () => {
    const onContinue = vi.fn()
    render(
      <MappingStep
        source={makeSource([])}
        participants={MISSING_EMAIL}
        account={account}
        onBack={vi.fn()}
        onChange={vi.fn()}
        onContinue={onContinue}
      />,
    )
    const continueBtn = screen.getByRole('button', { name: /continue to/i })
    expect(continueBtn).toBeDisabled()
    // userEvent respects `disabled` — clicking does nothing.
    await userEvent.setup().click(continueBtn)
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('calls onBack when Back is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <MappingStep
        source={makeSource([])}
        participants={ALL_VALID}
        account={account}
        onBack={onBack}
        onChange={vi.fn()}
        onContinue={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /back to/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('accepts a destinationParticipants list and considers LINK_EXISTING rows', () => {
    const destinationParticipants: DestinationParticipant[] = [
      { id: 'lp-1', name: 'Carol', pending: false, unlinked: false },
      { id: 'lp-2', name: 'Dave', pending: false, unlinked: false },
    ]
    const participants: ParticipantMappingState[] = [
      row({
        key: '0',
        sourceId: 'a',
        sourceName: 'Alice',
        mode: 'LINK_ACCOUNT',
        linkedAccountId: account.id,
      }),
      row({
        key: '1',
        sourceId: 'c',
        sourceName: 'Carol',
        mode: 'LINK_EXISTING_PARTICIPANT',
        existingLedgerParticipantId: 'lp-1',
      }),
    ]
    render(
      <MappingStep
        source={makeSource([])}
        participants={participants}
        account={account}
        destinationParticipants={destinationParticipants}
        onBack={vi.fn()}
        onChange={vi.fn()}
        onContinue={vi.fn()}
      />,
    )

    // With a destination list provided, every row picks up the
    // "Link to existing" radio.
    expect(
      screen.getAllByText(/link to existing/i).length,
    ).toBeGreaterThanOrEqual(1)
  })
})
