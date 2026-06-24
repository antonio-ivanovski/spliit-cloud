// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { describe, expect, it } from 'vitest'
import '../test/mocks'
import { prismaMock } from '../test/state'
import { getGroup } from '../lib/api'

describe('getGroup — pending invitations as participants', () => {
  const groupId = 'grp-1'
  const ledgerId = 'ledger-1'

  it('materializes a LedgerParticipant for a pending invitation and includes it in participants', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [
        {
          id: 'gm-owner',
          groupId,
          accountId: 'acct-owner',
          role: 'OWNER',
          status: 'ACTIVE',
          displayName: 'Alice',
          joinedAt: new Date(),
          ledgerParticipant: { id: 'lp-owner', name: 'Alice' },
          account: {
            id: 'acct-owner',
            email: 'alice@example.com',
            emailVerified: true,
            name: 'Alice',
          },
        },
      ],
      invitations: [
        {
          id: 'inv-1',
          groupId,
          email: 'bob@example.com',
          status: 'PENDING',
          ledgerParticipantId: null,
        },
      ],
    } as never)

    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue(null)
    // Capture the id used when creating the participant and return it from the
    // re-read so the API's response includes it as the materialized id.
    let createdId: string | undefined
    prismaMock.ledgerParticipant.create.mockImplementation((async (
      args: unknown,
    ) => {
      createdId = (args as { data: { id: string } }).data.id
      return { id: createdId } as never
    }) as never)
    prismaMock.groupInvitation.update.mockResolvedValue({} as never)
    prismaMock.groupInvitation.findMany.mockImplementation(
      (async () =>
        [
          {
            id: 'inv-1',
            groupId,
            ledgerParticipant: createdId
              ? { id: createdId, name: 'bob@example.com' }
              : null,
          },
        ] as never) as never,
    )

    const group = await getGroup(groupId)

    expect(group).not.toBeNull()
    const participants = group!.participants as Array<{
      id: string
      name: string
      pending: boolean
    }>
    expect(participants).toHaveLength(2)
    const owner = participants.find((p) => p.id === 'lp-owner')!
    const bob = participants.find((p) => p.pending) as {
      id: string
      name: string
      pending: boolean
    }
    expect(owner.pending).toBe(false)
    expect(owner.name).toBe('Alice')
    expect(bob.pending).toBe(true)
    expect(bob.name).toBe('bob@example.com')
    expect(typeof bob.id).toBe('string')
    expect(bob.id.length).toBeGreaterThan(0)
    expect(prismaMock.ledgerParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ledgerId,
          name: 'bob@example.com',
        }),
      }),
    )
    expect(prismaMock.groupInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ ledgerParticipantId: bob.id }),
      }),
    )
  })

  it('reuses an existing orphaned LedgerParticipant with a matching name when one is found', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [],
      invitations: [
        {
          id: 'inv-2',
          groupId,
          email: 'carol@example.com',
          status: 'PENDING',
          ledgerParticipantId: null,
        },
      ],
    } as never)

    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    prismaMock.ledgerParticipant.findFirst.mockResolvedValue({
      id: 'lp-existing',
    } as never)
    prismaMock.groupInvitation.update.mockResolvedValue({} as never)
    prismaMock.groupInvitation.findMany.mockResolvedValue([
      {
        id: 'inv-2',
        groupId,
        ledgerParticipant: {
          id: 'lp-existing',
          name: 'carol@example.com',
        },
      },
    ] as never)

    const group = await getGroup(groupId)

    expect(group!.participants).toHaveLength(1)
    expect(group!.participants[0]).toMatchObject({
      id: 'lp-existing',
      pending: true,
    })
    expect(prismaMock.ledgerParticipant.create).not.toHaveBeenCalled()
    expect(prismaMock.groupInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-2' },
        data: { ledgerParticipantId: 'lp-existing' },
      }),
    )
  })

  it('does not touch the database when the group has no pending invitations', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: groupId,
      name: 'Trip',
      information: null,
      createdAt: new Date(),
      ledgerId,
      ledger: { id: ledgerId, currency: '$', currencyCode: 'USD' },
      members: [
        {
          id: 'gm-owner',
          groupId,
          accountId: 'acct-owner',
          role: 'OWNER',
          status: 'ACTIVE',
          displayName: 'Alice',
          joinedAt: new Date(),
          ledgerParticipant: { id: 'lp-owner', name: 'Alice' },
          account: {
            id: 'acct-owner',
            email: 'alice@example.com',
            emailVerified: true,
            name: 'Alice',
          },
        },
      ],
      invitations: [],
    } as never)

    const group = await getGroup(groupId)

    expect(group!.participants).toEqual([
      { id: 'lp-owner', name: 'Alice', pending: false },
    ])
    expect(prismaMock.ledgerParticipant.create).not.toHaveBeenCalled()
    expect(prismaMock.groupInvitation.update).not.toHaveBeenCalled()
  })
})
