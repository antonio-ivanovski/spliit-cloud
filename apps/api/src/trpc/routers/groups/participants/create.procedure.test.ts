import { describe, expect, it } from 'vitest'

import '../../../../test/mocks'
import { authState, prismaMock } from '../../../../test/state'
import { groupsRouter } from '../index'

function makeCaller(authUserId = 'acct-member') {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'member@example.com',
        emailVerified: true,
        name: 'Member',
      },
    },
  } as never)
}

function seedGroup(opts?: {
  archived?: boolean
  groupType?: 'GROUP' | 'FRIEND'
}) {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'grp-1',
    ledgerId: 'ledger-1',
    archived: opts?.archived ?? false,
    groupType: opts?.groupType ?? 'GROUP',
    ledger: { id: 'ledger-1', currencyCode: 'USD' },
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue({
    id: 'gm-1',
    groupId: 'grp-1',
    accountId: 'acct-member',
    role: 'MEMBER',
    status: 'ACTIVE',
    ledgerParticipant: null,
  } as never)
}

describe('groupsRouter.participants.create', () => {
  it('creates a name-only participant for an active member', async () => {
    authState.session = {
      user: { id: 'acct-member' },
      session: { id: 'sess-1' },
    }
    seedGroup()
    prismaMock.ledgerParticipant.create.mockResolvedValue({
      id: 'lp-unlinked',
      displayName: 'Alex roommate',
    } as never)

    const result = await makeCaller().participants.create({
      groupId: 'grp-1',
      displayName: '  Alex roommate  ',
    })

    expect(result).toEqual({
      ledgerParticipantId: 'lp-unlinked',
      displayName: 'Alex roommate',
    })
    expect(prismaMock.ledgerParticipant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ledgerId: 'ledger-1',
        kind: 'UNLINKED_PARTICIPANT',
        displayName: 'Alex roommate',
      }),
      select: { id: true, displayName: true },
    })
  })

  it('rejects blank names at the input boundary', async () => {
    authState.session = {
      user: { id: 'acct-member' },
      session: { id: 'sess-1' },
    }
    seedGroup()

    await expect(
      makeCaller().participants.create({
        groupId: 'grp-1',
        displayName: '   ',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prismaMock.ledgerParticipant.create).not.toHaveBeenCalled()
  })

  it('rejects archived and friend ledgers', async () => {
    authState.session = {
      user: { id: 'acct-member' },
      session: { id: 'sess-1' },
    }
    seedGroup({ archived: true })
    await expect(
      makeCaller().participants.create({
        groupId: 'grp-1',
        displayName: 'Alex',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    seedGroup({ groupType: 'FRIEND' })
    await expect(
      makeCaller().participants.create({
        groupId: 'grp-1',
        displayName: 'Alex',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
