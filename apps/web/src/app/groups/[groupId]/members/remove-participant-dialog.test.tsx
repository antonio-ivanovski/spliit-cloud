import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CurrentGroupProvider } from '@/app/groups/[groupId]/current-group-context'
import { RemoveParticipantDialog } from '@/app/groups/[groupId]/members/remove-participant-dialog'
import { render, screen } from '@/test/test-utils'

function mockDesktopMediaQuery() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

function ParticipantDialogHarness({
  participantKind,
  hasUnsettledBalance = false,
  onConfirmRemove,
}: {
  participantKind: 'member' | 'invitation' | 'unlinked'
  hasUnsettledBalance?: boolean
  onConfirmRemove: (settleBalances?: boolean) => void
}) {
  const [settleChecked, setSettleChecked] = useState(false)

  return (
    <CurrentGroupProvider
      isLoading={false}
      group={{ currency: '€', currencyCode: 'EUR' } as never}
      groupId="group-1"
      displayName="Group"
      currentLedgerParticipantId="lp-owner"
      currentMember={null}
      currentInvitation={null}
      linkInviteState={null}
    >
      <RemoveParticipantDialog
        participantPendingRemove={{
          ledgerParticipantId: 'lp-target',
          name: 'Alex',
        }}
        removePreviewQuery={{
          isLoading: false,
          data: {
            participantName: 'Alex',
            participantKind,
            hasUnsettledBalance,
            currentBalance: hasUnsettledBalance ? 100 : 0,
            settlementLegs: [],
            currencyCode: 'EUR',
            participants: [{ id: 'lp-target', name: 'Alex' }],
          },
        }}
        participantRemoveSettleChecked={settleChecked}
        removeParticipantMutation={{ isPending: false }}
        onOpenChange={vi.fn()}
        onConfirmRemove={onConfirmRemove}
        onSettleCheckedChange={setSettleChecked}
      />
    </CurrentGroupProvider>
  )
}

describe('RemoveParticipantDialog', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['member', 'invitation', 'unlinked'] as const)(
    'requires the exact participant name before removing a %s',
    async (participantKind) => {
      mockDesktopMediaQuery()
      const onConfirmRemove = vi.fn()
      const { user } = render(
        <ParticipantDialogHarness
          participantKind={participantKind}
          onConfirmRemove={onConfirmRemove}
        />,
      )

      const confirmButton = screen.getByRole('button', { name: /remove/i })
      expect(confirmButton).toBeDisabled()
      expect(screen.getByText(/to remove/i)).toHaveTextContent(
        'To remove Alex from this group, type their name exactly as shown below.',
      )
      const input = screen.getByRole('textbox', { name: /enter the name/i })
      expect(input).toHaveAttribute('placeholder', 'Type “Alex” here')
      await user.type(input, 'alex')
      expect(confirmButton).toBeDisabled()
      await user.clear(input)
      await user.type(input, 'Alex')
      expect(confirmButton).toBeEnabled()
      await user.click(confirmButton)

      expect(onConfirmRemove).toHaveBeenCalledWith(undefined)
    },
  )

  it('requires both the exact name and settlement acknowledgement', async () => {
    mockDesktopMediaQuery()
    const onConfirmRemove = vi.fn()
    const { user } = render(
      <ParticipantDialogHarness
        participantKind="member"
        hasUnsettledBalance
        onConfirmRemove={onConfirmRemove}
      />,
    )

    const confirmButton = screen.getByRole('button', { name: /remove/i })
    await user.type(screen.getByRole('textbox'), 'Alex')
    expect(confirmButton).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)

    expect(onConfirmRemove).toHaveBeenCalledWith(true)
  })
})
