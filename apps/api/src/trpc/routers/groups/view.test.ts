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
    prismaMock.group.findFirst.mockResolvedValue(null)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
  })

  it('returns the stable query-param link to a regular active member without management access', async () => {
    seedMember({ role: 'MEMBER', publicViewKey: 'view-key-member' })

    const first = await makeCaller().view.get({ groupId: 'group-1' })
    const second = await makeCaller().view.get({ groupId: 'group-1' })

    expect(first).toEqual(second)
    expect(first.canManage).toBe(false)
    expect(first.url).toBe(
      'http://localhost:3000/groups/group-1?viewKey=view-key-member',
    )
  })

  it('allows only an admin to enable the public link', async () => {
    seedMember({ role: 'MEMBER' })
    await expect(
      makeCaller().view.enable({ groupId: 'group-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    seedMember({ role: 'ADMIN' })
    const result = await makeCaller().view.enable({ groupId: 'group-1' })
    expect(result.url).toMatch(
      /^http:\/\/localhost:3000\/groups\/group-1\?viewKey=[A-Za-z0-9_-]+$/,
    )
    expect(prismaMock.group.updateMany).toHaveBeenCalledWith({
      where: { id: 'group-1', publicViewKey: null },
      data: { publicViewKey: expect.stringMatching(/^[A-Za-z0-9_-]+$/) },
    })
    expect(prismaMock.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'GROUP_UPDATED',
        actorType: 'ACCOUNT',
        actorId: 'account-1',
        subjectType: 'GROUP',
        subjectId: 'group-1',
        data: expect.objectContaining({
          kind: 'group',
          summary: 'publicViewLink:enabled',
          changedFields: ['publicViewLink'],
        }),
      }),
    })
  })

  it('replaces and removes the current key only after explicit confirmation', async () => {
    seedMember({ role: 'ADMIN', publicViewKey: 'view-key-admin' })

    const replacement = await makeCaller().view.replace({
      groupId: 'group-1',
      confirmed: true,
    })
    expect(replacement.url).toMatch(
      /^http:\/\/localhost:3000\/groups\/group-1\?viewKey=[A-Za-z0-9_-]+$/,
    )
    expect(prismaMock.group.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'group-1', publicViewKey: { not: null } },
      data: { publicViewKey: expect.stringMatching(/^[A-Za-z0-9_-]+$/) },
    })

    await expect(
      makeCaller().view.remove({ groupId: 'group-1', confirmed: true }),
    ).resolves.toEqual({ removed: true })
    expect(prismaMock.group.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'group-1', publicViewKey: { not: null } },
      data: { publicViewKey: null },
    })
    expect(prismaMock.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'GROUP_UPDATED',
        data: expect.objectContaining({
          summary: 'publicViewLink:replaced',
        }),
      }),
    })
    expect(prismaMock.activity.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        type: 'GROUP_UPDATED',
        data: expect.objectContaining({
          summary: 'publicViewLink:removed',
        }),
      }),
    })
  })

  it('rejects public links for friend ledgers', async () => {
    seedMember({ role: 'ADMIN', groupType: 'FRIEND' })
    await expect(
      makeCaller().view.get({ groupId: 'group-1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('reports concurrent public-link state changes consistently', async () => {
    seedMember({ role: 'ADMIN', publicViewKey: 'view-key-conflict' })
    prismaMock.group.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      makeCaller().view.enable({ groupId: 'group-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      makeCaller().view.replace({ groupId: 'group-1', confirmed: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      makeCaller().view.remove({ groupId: 'group-1', confirmed: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
