import type { AccountGroup } from '@/app/groups/group-buckets'
import { bucketFor, partitionGroups } from '@/app/groups/group-buckets'
import { describe, expect, it } from 'vitest'

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    name: 'Group',
    groupType: 'GROUP' as const,
    archived: false,
    createdAt: '2026-06-01T00:00:00Z',
    displayName: 'Group',
    memberCount: 4,
    currentMemberRole: 'ADMIN' as const,
    preference: { starred: false, hidden: false },
    information: null,
    updatedAt: '2026-06-01T00:00:00Z',
    ledgerId: 'l1',
    currency: 'USD',
    currencyCode: 'USD',
    ledger: {
      id: 'l1',
      currency: 'USD',
      currencyCode: 'USD',
      groupId: 'g1',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    },
    members: [],
    invitations: [],
    ...overrides,
  } as unknown as AccountGroup
}

describe('bucketFor', () => {
  it('puts a hidden group in the hidden bucket regardless of type', () => {
    const group = makeGroup({
      preference: { starred: false, hidden: true },
    })
    expect(bucketFor(group)).toBe('hidden')
  })

  it('puts a starred FRIEND group in starred (not friends)', () => {
    const group = makeGroup({
      groupType: 'FRIEND',
      preference: { starred: true, hidden: false },
    })
    expect(bucketFor(group)).toBe('starred')
  })

  it('puts a non-starred FRIEND group in the friends bucket', () => {
    const group = makeGroup({
      groupType: 'FRIEND',
      preference: { starred: false, hidden: false },
    })
    expect(bucketFor(group)).toBe('friends')
  })

  it('puts a starred GROUP group in starred', () => {
    const group = makeGroup({
      groupType: 'GROUP',
      preference: { starred: true, hidden: false },
    })
    expect(bucketFor(group)).toBe('starred')
  })

  it('puts an archived GROUP in the archived bucket', () => {
    const group = makeGroup({
      archived: true,
      preference: { starred: false, hidden: false },
    })
    expect(bucketFor(group)).toBe('archived')
  })

  it('puts a regular non-archived GROUP in the groups bucket', () => {
    const group = makeGroup({
      archived: false,
      preference: { starred: false, hidden: false },
    })
    expect(bucketFor(group)).toBe('groups')
  })

  it('skips the archived bucket for FRIEND (defense-in-depth)', () => {
    // Even if a stale row had groupType=FRIEND and archived=true,
    // the bucket function should return 'friends' (not 'archived').
    const group = makeGroup({
      groupType: 'FRIEND',
      archived: true,
      preference: { starred: false, hidden: false },
    })
    expect(bucketFor(group)).toBe('friends')
  })
})

describe('partitionGroups', () => {
  it('sorts each bucket by newest expense creation time', () => {
    const older = makeGroup({
      id: 'older',
      financialSummary: {
        expenseCount: 1,
        netBalance: 0,
        state: 'SETTLED',
        latestExpenseCreatedAt: '2026-06-02T00:00:00Z',
      },
    })
    const newer = makeGroup({
      id: 'newer',
      financialSummary: {
        expenseCount: 1,
        netBalance: 0,
        state: 'SETTLED',
        latestExpenseCreatedAt: '2026-06-03T00:00:00Z',
      },
    })

    expect(partitionGroups([older, newer]).groups.map((g) => g.id)).toEqual([
      'newer',
      'older',
    ])
  })

  it('partitions groups and friends into separate arrays', () => {
    const g1 = makeGroup({ id: 'g1', groupType: 'GROUP' })
    const g2 = makeGroup({ id: 'g2', groupType: 'GROUP' })
    const f1 = makeGroup({ id: 'f1', groupType: 'FRIEND' })
    const f2 = makeGroup({ id: 'f2', groupType: 'FRIEND' })

    const result = partitionGroups([g1, f1, g2, f2])

    expect(result.groups.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(result.friends.map((g) => g.id)).toEqual(['f1', 'f2'])
    expect(result.starred).toEqual([])
    expect(result.archived).toEqual([])
    expect(result.hidden).toEqual([])
  })

  it('pulls starred groups out of the groups/friends arrays', () => {
    const g1 = makeGroup({ id: 'g1', groupType: 'GROUP' })
    const f1 = makeGroup({
      id: 'f1',
      groupType: 'FRIEND',
      preference: { starred: true, hidden: false },
    })
    const g2 = makeGroup({
      id: 'g2',
      groupType: 'GROUP',
      preference: { starred: true, hidden: false },
    })

    const result = partitionGroups([g1, f1, g2])

    expect(result.groups.map((g) => g.id)).toEqual(['g1'])
    expect(result.friends).toEqual([])
    expect(result.starred.map((g) => g.id)).toEqual(['f1', 'g2'])
  })

  it('puts hidden groups in the hidden bucket and removes them from others', () => {
    const g1 = makeGroup({ id: 'g1' })
    const g2 = makeGroup({
      id: 'g2',
      preference: { starred: false, hidden: true },
    })

    const result = partitionGroups([g1, g2])

    expect(result.groups.map((g) => g.id)).toEqual(['g1'])
    expect(result.hidden.map((g) => g.id)).toEqual(['g2'])
  })

  it('puts archived GROUPs in the archived bucket', () => {
    const g1 = makeGroup({ id: 'g1' })
    const g2 = makeGroup({ id: 'g2', archived: true })

    const result = partitionGroups([g1, g2])

    expect(result.groups.map((g) => g.id)).toEqual(['g1'])
    expect(result.archived.map((g) => g.id)).toEqual(['g2'])
  })
})
