import { describe, expect, it } from 'vitest'
import '../../../test/mocks'
import { authState, prismaMock } from '../../../test/state'
import { createTRPCContext } from '../../init'
import { accountRouter } from './index'

function makeCaller(authUserId: string) {
  return accountRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never)
}

async function authAs(userId: string) {
  authState.session = {
    user: { id: userId },
    session: { id: 'sess-1' },
  }
  prismaMock.account.findUnique.mockImplementation(async (args: unknown) => {
    const id = (args as { where: { id: string } }).where.id
    return {
      id,
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    }
  })
  return createTRPCContext({
    req: new Request('http://localhost/api/test'),
  })
}

function mockGroupWithMembership(
  userId: string,
  groups: Array<{
    id: string
    archived: boolean
    role: 'OWNER' | 'ADMIN' | 'MEMBER'
    members: number
    preferences?: Partial<{
      starred: boolean
      archived: boolean
      pinned: boolean
      hidden: boolean
    }>
  }>,
) {
  prismaMock.groupMember.findMany.mockResolvedValue(
    groups.map((g) => ({
      groupId: g.id,
      accountId: userId,
      role: g.role,
      status: 'ACTIVE',
      group: {
        id: g.id,
        name: `Group ${g.id}`,
        information: null,
        archived: g.archived,
        createdAt: new Date(),
        ledger: { currency: '$', currencyCode: 'USD' },
        _count: { members: g.members },
      },
    })) as never,
  )
  const prefs = groups
    .filter((g) => g.preferences)
    .map((g) => ({
      groupId: g.id,
      starred: false,
      archived: false,
      pinned: false,
      hidden: false,
      ...g.preferences,
    }))
  prismaMock.accountGroupPreference.findMany.mockResolvedValue(prefs as never)
}

describe('accountRouter.setPreference — hide API', () => {
  it('maps `hidden` to the underlying `archived` column', async () => {
    await authAs('acct-1')
    prismaMock.accountGroupPreference.upsert.mockResolvedValue({
      id: 'pref-1',
      groupId: 'grp-1',
      accountId: 'acct-1',
      starred: false,
      archived: true,
      pinned: false,
      hidden: false,
    } as never)

    const caller = makeCaller('acct-1')
    const result = await caller.setPreference({
      groupId: 'grp-1',
      hidden: true,
    })

    expect(result.preferences).toMatchObject({ hidden: true })
    expect(prismaMock.accountGroupPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ archived: true }),
        update: { archived: true },
      }),
    )
  })

  it('returns the preference with `hidden` (not `archived`) in the response', async () => {
    await authAs('acct-1')
    prismaMock.accountGroupPreference.upsert.mockResolvedValue({
      id: 'pref-1',
      starred: false,
      archived: false,
      pinned: true,
      hidden: false,
    } as never)

    const caller = makeCaller('acct-1')
    const result = await caller.setPreference({
      groupId: 'grp-1',
      pinned: true,
    })

    expect(result.preferences).toEqual({
      starred: false,
      hidden: false,
      pinned: true,
    })
  })
})

describe('accountRouter.preferences — hide API', () => {
  it('maps the `archived` column to `hidden` in the response', async () => {
    await authAs('acct-1')
    prismaMock.accountGroupPreference.findUnique.mockResolvedValue({
      id: 'pref-1',
      accountId: 'acct-1',
      groupId: 'grp-1',
      starred: true,
      archived: true,
      pinned: false,
      hidden: false,
    } as never)

    const caller = makeCaller('acct-1')
    const result = await caller.preferences({ groupId: 'grp-1' })

    expect(result.preferences).toEqual({
      starred: true,
      hidden: true,
      pinned: false,
    })
  })

  it('returns the default preference (no archived column) when no row exists', async () => {
    await authAs('acct-1')
    prismaMock.accountGroupPreference.findUnique.mockResolvedValue(null)

    const caller = makeCaller('acct-1')
    const result = await caller.preferences({ groupId: 'grp-1' })

    expect(result.preferences).toEqual({
      starred: false,
      hidden: false,
      pinned: false,
    })
  })
})

describe('accountRouter.groups — archive + hide filters', () => {
  it('excludes group-archived and user-hidden groups by default', async () => {
    await authAs('acct-1')
    mockGroupWithMembership('acct-1', [
      { id: 'g-active', archived: false, role: 'OWNER', members: 2 },
      { id: 'g-archived', archived: true, role: 'OWNER', members: 3 },
      {
        id: 'g-hidden',
        archived: false,
        role: 'OWNER',
        members: 2,
        preferences: { archived: true }, // user "hide" preference
      },
    ])

    const caller = makeCaller('acct-1')
    const result = await caller.groups({ includeArchived: false })

    expect(result.groups.map((g) => g.id)).toEqual(['g-active'])
  })

  it('includes group-archived and user-hidden groups when includeArchived is true', async () => {
    await authAs('acct-1')
    mockGroupWithMembership('acct-1', [
      { id: 'g-active', archived: false, role: 'OWNER', members: 2 },
      { id: 'g-archived', archived: true, role: 'OWNER', members: 3 },
      {
        id: 'g-hidden',
        archived: false,
        role: 'OWNER',
        members: 2,
        preferences: { archived: true },
      },
    ])

    const caller = makeCaller('acct-1')
    const result = await caller.groups({ includeArchived: true })

    expect(result.groups.map((g) => g.id).sort()).toEqual([
      'g-active',
      'g-archived',
      'g-hidden',
    ])
    // The API exposes the per-account hide preference as `preference.hidden`,
    // not `preference.archived`.
    const hidden = result.groups.find((g) => g.id === 'g-hidden')!
    expect(hidden.preference).toMatchObject({ hidden: true })
    expect(hidden.preference).not.toHaveProperty('archived')
  })

  it('includes the caller role for each group in the response', async () => {
    await authAs('acct-1')
    mockGroupWithMembership('acct-1', [
      { id: 'g-1', archived: false, role: 'ADMIN', members: 2 },
      { id: 'g-2', archived: false, role: 'MEMBER', members: 3 },
    ])

    const caller = makeCaller('acct-1')
    const result = await caller.groups({ includeArchived: false })

    expect(result.groups.find((g) => g.id === 'g-1')?.currentMemberRole).toBe(
      'ADMIN',
    )
    expect(result.groups.find((g) => g.id === 'g-2')?.currentMemberRole).toBe(
      'MEMBER',
    )
  })
})
