import { beforeEach, describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
import { groupsRouter } from './index'

function makeCaller() {
  return groupsRouter.createCaller({
    auth: {
      session: { id: 'session-1' },
      user: {
        id: 'account-1',
        email: 'alice@example.com',
        emailVerified: true,
        isAnonymous: false,
        name: 'Alice',
      },
    },
  } as never)
}

function seedMember(args: {
  role: 'ADMIN' | 'MEMBER'
  publicViewKey?: string | null
  groupType?: 'GROUP' | 'FRIEND'
}) {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'group-1',
    groupType: args.groupType ?? 'GROUP',
    publicViewKey: args.publicViewKey ?? null,
    ledger: { id: 'ledger-1' },
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue({
    id: 'member-1',
    role: args.role,
    status: 'ACTIVE',
    ledgerParticipant: { id: 'participant-1' },
  } as never)
}

describe('groups.view', () => {
  beforeEach(() => {
    prismaMock.group.updateMany.mockResolvedValue({ count: 1 })
  })

  it('returns the stable link to a regular active member without management access', async () => {
    seedMember({ role: 'MEMBER', publicViewKey: 'stable-key' })

    const first = await makeCaller().view.get({ groupId: 'group-1' })
    const second = await makeCaller().view.get({ groupId: 'group-1' })

    expect(first).toEqual(second)
    expect(first.canManage).toBe(false)
    expect(first.url).toContain('/groups/group-1#view=stable-key')
  })

  it('allows only an admin to enable the public link', async () => {
    seedMember({ role: 'MEMBER' })
    await expect(
      makeCaller().view.enable({ groupId: 'group-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    seedMember({ role: 'ADMIN' })
    const result = await makeCaller().view.enable({ groupId: 'group-1' })
    expect(result.url).toMatch(/#view=spliit_group_view_v1_/)
    expect(prismaMock.group.updateMany).toHaveBeenCalledWith({
      where: { id: 'group-1', publicViewKey: null },
      data: { publicViewKey: expect.stringMatching(/^spliit_group_view_v1_/) },
    })
  })

  it('replaces and removes the current key only after explicit confirmation', async () => {
    seedMember({ role: 'ADMIN', publicViewKey: 'old-key' })

    const replacement = await makeCaller().view.replace({
      groupId: 'group-1',
      confirmed: true,
    })
    expect(replacement.url).toMatch(/#view=spliit_group_view_v1_/)
    expect(prismaMock.group.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'group-1', publicViewKey: { not: null } },
      data: { publicViewKey: expect.stringMatching(/^spliit_group_view_v1_/) },
    })

    await expect(
      makeCaller().view.remove({ groupId: 'group-1', confirmed: true }),
    ).resolves.toEqual({ removed: true })
    expect(prismaMock.group.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'group-1', publicViewKey: { not: null } },
      data: { publicViewKey: null },
    })
  })

  it('rejects public links for friend ledgers', async () => {
    seedMember({ role: 'ADMIN', groupType: 'FRIEND' })
    await expect(
      makeCaller().view.get({ groupId: 'group-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
