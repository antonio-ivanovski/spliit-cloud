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

function seedPublicView(args?: { member?: boolean; viewKey?: string }) {
  prismaMock.group.findUnique.mockResolvedValue({
    id: 'group-1',
    name: 'Trip',
    groupType: 'GROUP',
    publicViewKey: args?.viewKey ?? 'view-secret',
    ledger: { id: 'ledger-1' },
  } as never)
  prismaMock.groupMember.findUnique.mockResolvedValue(
    args?.member
      ? ({
          id: 'member-1',
          role: 'MEMBER',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'participant-1' },
        } as never)
      : (null as never),
  )
  prismaMock.groupInvitation.findFirst.mockResolvedValue(null as never)
}

describe('groups.savedViews', () => {
  beforeEach(() => {
    prismaMock.accountSavedView.upsert.mockImplementation(async (args) => {
      const input = args as {
        create: Record<string, unknown>
        update: Record<string, unknown>
      }
      return {
        ...input.create,
        ...input.update,
        groupId: 'group-1',
        lastOpenedAt:
          (input.create.lastOpenedAt as Date | undefined) ??
          (input.update.lastOpenedAt as Date | undefined) ??
          new Date(),
      } as never
    })
    prismaMock.accountSavedView.findUnique.mockResolvedValue(null as never)
    prismaMock.accountSavedView.deleteMany.mockResolvedValue({
      count: 0,
    } as never)
  })

  it('saves a public view-only group for the account', async () => {
    seedPublicView()

    const result = await makeCaller().savedViews.save({
      groupId: 'group-1',
      viewKey: 'view-secret',
    })

    expect(result).toMatchObject({
      groupId: 'group-1',
      viewKey: 'view-secret',
    })
    expect(prismaMock.accountSavedView.upsert).toHaveBeenCalled()
  })

  it('rejects save when the account is already a member and drops any bookmark', async () => {
    seedPublicView({ member: true })

    await expect(
      makeCaller().savedViews.save({
        groupId: 'group-1',
        viewKey: 'view-secret',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prismaMock.accountSavedView.deleteMany).toHaveBeenCalledWith({
      where: { accountId: 'account-1', groupId: 'group-1' },
    })
    expect(prismaMock.accountSavedView.upsert).not.toHaveBeenCalled()
  })

  it('touches an existing bookmark and no-ops when none exists', async () => {
    seedPublicView()
    prismaMock.accountSavedView.findUnique.mockResolvedValueOnce(null as never)
    expect(
      await makeCaller().savedViews.touch({
        groupId: 'group-1',
        viewKey: 'view-secret',
      }),
    ).toBeNull()

    prismaMock.accountSavedView.findUnique.mockResolvedValue({
      groupId: 'group-1',
      viewKey: 'old-key',
    } as never)
    const touched = await makeCaller().savedViews.touch({
      groupId: 'group-1',
      viewKey: 'view-secret',
    })
    expect(touched).toMatchObject({
      groupId: 'group-1',
      viewKey: 'view-secret',
    })
  })

  it('removes a bookmark without revoking the public link', async () => {
    await makeCaller().savedViews.remove({ groupId: 'group-1' })
    expect(prismaMock.accountSavedView.deleteMany).toHaveBeenCalledWith({
      where: { accountId: 'account-1', groupId: 'group-1' },
    })
  })

  it('merges valid device bookmarks and skips members and invalid keys', async () => {
    prismaMock.group.findUnique.mockImplementation(async (args) => {
      const id = (args as { where: { id: string } }).where.id
      if (id === 'group-1') {
        return {
          id: 'group-1',
          name: 'Trip',
          groupType: 'GROUP',
          publicViewKey: 'good-key',
          ledger: { id: 'ledger-1' },
        } as never
      }
      if (id === 'group-2') {
        return {
          id: 'group-2',
          name: 'Dinner',
          groupType: 'GROUP',
          publicViewKey: 'other-key',
          ledger: { id: 'ledger-2' },
        } as never
      }
      return {
        id: 'group-3',
        name: 'Member group',
        groupType: 'GROUP',
        publicViewKey: 'member-key',
        ledger: { id: 'ledger-3' },
      } as never
    })
    prismaMock.groupMember.findUnique.mockImplementation(async (args) => {
      const groupId = (
        args as { where: { groupId_accountId: { groupId: string } } }
      ).where.groupId_accountId.groupId
      if (groupId === 'group-3') {
        return {
          id: 'member-1',
          role: 'MEMBER',
          status: 'ACTIVE',
          ledgerParticipant: { id: 'p-1' },
        } as never
      }
      return null as never
    })
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null as never)

    const result = await makeCaller().savedViews.merge({
      items: [
        { groupId: 'group-1', viewKey: 'good-key' },
        { groupId: 'group-2', viewKey: 'stale-key' },
        { groupId: 'group-3', viewKey: 'member-key' },
      ],
    })

    expect(result).toEqual({
      saved: 1,
      skipped: 2,
      completedGroupIds: ['group-1', 'group-2', 'group-3'],
    })
  })
})
