import { describe, expect, it } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { assistantRouter, GROUP_RESPONSE_CAP } from './assistant'

function oauthContext(accountId: string) {
  return {
    auth: {
      credentialKind: 'oauth' as const,
      accessToken: 'redacted',
      scopes: ['spliit:groups:read', 'spliit:expenses:write'],
      user: {
        id: accountId,
        name: 'Alice',
        email: 'alice@example.com',
      },
      session: { id: `oauth:${accountId}` },
    },
  } as never
}

const group = {
  id: 'group-abcdef1234',
  name: 'Summer trip',
  groupType: 'GROUP',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  ledger: {
    currency: '$',
    currencyCode: 'USD',
    participants: [
      {
        id: 'participant-alice',
        displayName: null,
        groupMember: {
          accountId: 'account-a',
          account: { name: 'Alice' },
        },
        invitations: [],
      },
      {
        id: 'participant-bob',
        displayName: 'Bob',
        groupMember: null,
        invitations: [],
      },
    ],
  },
  members: [
    { accountId: 'account-a', account: { name: 'Alice' } },
    { accountId: 'account-b', account: { name: 'Bob' } },
  ],
}

describe('assistant listGroups account isolation', () => {
  it('queries only the verified OAuth account and removes duplicate group rows', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([
      { group },
      { group },
    ] as never)

    const result = await assistantRouter
      .createCaller(oauthContext('account-a'))
      .listGroups()

    expect(prismaMock.groupMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: 'account-a',
          status: 'ACTIVE',
          group: expect.objectContaining({ archived: false }),
        }),
      }),
    )
    expect(result.connectedAccount).toEqual({ name: 'Alice' })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({
      id: group.id,
      name: group.name,
      participantCount: 2,
      callerParticipantId: 'participant-alice',
      participants: [
        {
          id: 'participant-alice',
          name: 'Alice',
          status: 'ACTIVE',
          isCaller: true,
          disambiguationLabel: 'Alice',
        },
        {
          id: 'participant-bob',
          name: 'Bob',
          status: 'UNLINKED',
          isCaller: false,
          disambiguationLabel: 'Bob',
        },
      ],
    })
    expect(result.categories).toContainEqual({
      id: 'dining-out',
      grouping: 'Food and Drink',
      name: 'Dining Out',
    })
  })

  it('adds stable labels only when distinct authorized groups share a name', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([
      { group },
      {
        group: {
          ...group,
          id: 'group-fedcba9876',
          name: 'summer trip',
        },
      },
    ] as never)

    const result = await assistantRouter
      .createCaller(oauthContext('account-a'))
      .listGroups()

    expect(result.groups.map((item) => item.disambiguationLabel)).toEqual([
      'Summer trip · group · group-ab',
      'summer trip · group · group-fe',
    ])
  })

  it('adds stable participant labels only for duplicate names in one group', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([
      {
        group: {
          ...group,
          ledger: {
            ...group.ledger,
            participants: [
              group.ledger.participants[0],
              {
                ...group.ledger.participants[1],
                id: 'participant-alice-2',
                displayName: 'alice',
              },
            ],
          },
        },
      },
    ] as never)

    const result = await assistantRouter
      .createCaller(oauthContext('account-a'))
      .listGroups()

    expect(
      result.groups[0].participants.map(
        (participant) => participant.disambiguationLabel,
      ),
    ).toEqual(['Alice · nt-alice', 'alice · -alice-2'])
  })

  it('shortens placeholder emails in participant labels', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([
      {
        group: {
          ...group,
          ledger: {
            ...group.ledger,
            participants: [
              {
                id: 'participant-placeholder',
                displayName: null,
                groupMember: null,
                invitations: [
                  {
                    email: 'abcdefghijk@link.placeholder.local',
                    temporaryName: null,
                  },
                ],
              },
            ],
          },
        },
      },
    ] as never)

    const result = await assistantRouter
      .createCaller(oauthContext('account-a'))
      .listGroups()

    expect(result.groups[0]?.participants[0]).toMatchObject({
      id: 'participant-placeholder',
      name: 'abcdefgh…',
    })
  })
})

function makeGroup(id: string, name: string) {
  return {
    id,
    name,
    groupType: 'GROUP',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ledger: {
      currency: '$',
      currencyCode: 'USD',
      participants: [
        {
          id: `participant-${id}`,
          displayName: null,
          groupMember: { accountId: 'account-a', account: { name: 'Alice' } },
          invitations: [],
        },
      ],
    },
    members: [{ accountId: 'account-a', account: { name: 'Alice' } }],
  }
}

describe('assistant listGroups narrowing and cap', () => {
  it('narrows groups case-insensitively with groupHint', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([
      { group: makeGroup('group-1', 'Summer Trip') },
      { group: makeGroup('group-2', 'Winter Cabin') },
      { group: makeGroup('group-3', 'summer house') },
    ] as never)

    const result = await assistantRouter
      .createCaller(oauthContext('account-a'))
      .listGroups({ groupHint: 'SUMMER' })

    expect(result.totalGroups).toBe(2)
    expect(result.truncated).toBe(false)
    expect(result.groups.map((group) => group.id)).toEqual([
      'group-1',
      'group-3',
    ])
  })

  it('returns no groups when the hint matches nothing, still account-scoped', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([
      { group: makeGroup('group-1', 'Summer Trip') },
    ] as never)

    const result = await assistantRouter
      .createCaller(oauthContext('account-a'))
      .listGroups({ groupHint: 'nomatch' })

    expect(result.totalGroups).toBe(0)
    expect(result.groups).toEqual([])
    expect(prismaMock.groupMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountId: 'account-a' }),
      }),
    )
  })

  it('caps large responses and flags truncation', async () => {
    const total = GROUP_RESPONSE_CAP + 5
    prismaMock.groupMember.findMany.mockResolvedValue(
      Array.from({ length: total }, (_, i) => ({
        group: makeGroup(`group-${i}`, `Group ${i}`),
      })),
    ) as never

    const result = await assistantRouter
      .createCaller(oauthContext('account-a'))
      .listGroups()

    expect(result.totalGroups).toBe(total)
    expect(result.truncated).toBe(true)
    expect(result.groups).toHaveLength(GROUP_RESPONSE_CAP)
  })

  it('uses groupHint to drill into a truncated account', async () => {
    const total = GROUP_RESPONSE_CAP + 10
    prismaMock.groupMember.findMany.mockResolvedValue(
      Array.from({ length: total }, (_, i) => ({
        group: makeGroup(`group-${i}`, i === 3 ? 'Unique Cabin' : `Group ${i}`),
      })),
    ) as never

    const result = await assistantRouter
      .createCaller(oauthContext('account-a'))
      .listGroups({ groupHint: 'cabin' })

    expect(result.totalGroups).toBe(1)
    expect(result.truncated).toBe(false)
    expect(result.groups[0]).toMatchObject({
      id: 'group-3',
      name: 'Unique Cabin',
    })
  })
})
