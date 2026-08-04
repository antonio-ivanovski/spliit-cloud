import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor } from '@/test/test-utils'

import type { PendingInvitation } from './members-hooks'
import { RegenerateLinkDialog } from './regenerate-link-dialog'

vi.mock(import('@/lib/hooks'), async (importActual) => {
  const actual = await importActual()
  return { ...actual, useMediaQuery: () => true }
})

const mocks = vi.hoisted(() => ({
  regenerateMutate: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function makeInvitation(
  overrides: Partial<PendingInvitation> = {},
): PendingInvitation {
  return {
    id: 'inv-1',
    groupId: 'grp-1',
    type: 'LINK',
    email: 'abc@link.placeholder.local',
    temporaryName: 'Guest',
    role: 'MEMBER',
    status: 'PENDING',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    expiresAt: new Date('2026-02-01T00:00:00Z'),
    ledgerParticipantId: 'lp-1',
    canRevoke: true,
    canManage: true,
    recipientProfile: null,
    ...overrides,
  }
}

function renderDialog(
  invitation: PendingInvitation | null,
  overrides: { isPending?: boolean } = {},
) {
  const onOpenChange = vi.fn()
  const { user } = render(
    <RegenerateLinkDialog
      invitation={invitation}
      groupName="Roadtrip 2026"
      regenerateLink={{
        mutateAsync: mocks.regenerateMutate,
        isPending: overrides.isPending ?? false,
      }}
      onOpenChange={onOpenChange}
    />,
  )
  return { user, onOpenChange }
}

describe('RegenerateLinkDialog', () => {
  it('shows the warning and asks for confirmation before invalidating', () => {
    renderDialog(makeInvitation())
    expect(
      screen.getByRole('heading', { name: 'Generate new link' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/current link will stop working immediately/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/fresh 30-day expiry/i)).toBeInTheDocument()
    expect(mocks.regenerateMutate).not.toHaveBeenCalled()
  })

  it('regenerates on confirm and shows the one-time URL with Done', async () => {
    mocks.regenerateMutate.mockResolvedValue({
      invitation: makeInvitation({
        expiresAt: new Date('2026-03-01T00:00:00Z'),
      }),
      inviteUrl: 'http://localhost:3000/groups/grp-1?invite=newtoken',
    })
    const { user } = renderDialog(makeInvitation())
    await user.click(screen.getByRole('button', { name: 'Generate new link' }))

    await waitFor(() => {
      expect(mocks.regenerateMutate).toHaveBeenCalledWith({
        invitationId: 'inv-1',
      })
    })
    expect(
      screen.getByRole('heading', { name: 'New link ready' }),
    ).toBeInTheDocument()
    expect(
      screen.getByDisplayValue(
        'http://localhost:3000/groups/grp-1?invite=newtoken',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('stays on the confirmation view with the error when regeneration fails', async () => {
    mocks.regenerateMutate.mockRejectedValue(new Error('Not allowed'))
    const { user } = renderDialog(makeInvitation())
    await user.click(screen.getByRole('button', { name: 'Generate new link' }))

    await waitFor(() => {
      expect(screen.getByText(/Not allowed/i)).toBeInTheDocument()
    })
    expect(
      screen.getByText(/current link will stop working immediately/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Done' }),
    ).not.toBeInTheDocument()
  })

  it('closes without regenerating on cancel', async () => {
    const { user, onOpenChange } = renderDialog(makeInvitation())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.regenerateMutate).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
