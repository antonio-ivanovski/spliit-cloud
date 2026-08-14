import { describe, expect, it } from 'vitest'

import { redactGroupForViewer } from './group-view-redaction'

describe('public group redaction', () => {
  it('removes invitations and contact fields while preserving useful names', () => {
    const group = {
      id: 'group-1',
      friendPairKey: 'pair-secret',
      invitations: [{ id: 'invite-1', email: 'pending@example.com' }],
      members: [
        {
          id: 'member-1',
          accountId: 'account-1',
          account: {
            id: 'account-1',
            name: 'Alice',
            email: 'alice@example.com',
            image: 'https://example.com/avatar.png',
          },
          ledgerParticipant: { id: 'participant-1', groupMemberId: 'member-1' },
        },
      ],
      participants: [
        {
          id: 'participant-1',
          name: 'Alice',
          pending: false,
          account: {
            id: 'account-1',
            name: 'Alice',
            email: 'alice@example.com',
            image: 'https://example.com/avatar.png',
          },
        },
        {
          id: 'participant-2',
          name: 'pending@example.com',
          pending: true,
          account: null,
        },
      ],
    }

    const redacted = redactGroupForViewer(group as never)

    expect(redacted.friendPairKey).toBeNull()
    expect(redacted.invitations).toEqual([])
    expect(redacted.members[0]?.account).toEqual({
      id: expect.stringMatching(/^public_/),
      name: 'Alice',
      image: null,
    })
    expect(redacted.participants[0]?.account).toEqual({
      id: expect.stringMatching(/^public_/),
      name: 'Alice',
      image: null,
    })
    expect(redacted.participants[1]?.name).toBe('')
  })
})
