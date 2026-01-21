import { prisma } from '@/lib/prisma'
import type { SyncProvider, SyncedGroupData } from './types'

const prismaClient = prisma as any

export const spliitCloudProvider: SyncProvider = {
  id: 'spliit-cloud',
  name: 'Spliit Cloud',

  isConfigured() {
    // Spliit Cloud is always configured (uses internal DB)
    return true
  },

  async push(userId: string, groups: SyncedGroupData[]) {
    // Delete existing synced groups for user
    await prismaClient.syncedGroup.deleteMany({ where: { userId } })

    // Insert new groups
    if (groups.length > 0) {
      await prismaClient.syncedGroup.createMany({
        data: groups.map((g) => ({
          userId,
          groupId: g.groupId,
          groupName: g.groupName,
          addedAt: g.addedAt,
        })),
      })
    }
  },

  async pull(userId: string) {
    const groups = (await prismaClient.syncedGroup.findMany({
      where: { userId },
      orderBy: { addedAt: 'desc' },
    })) as Array<{ groupId: string; groupName: string; addedAt: Date }>

    return groups.map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      addedAt: g.addedAt,
    }))
  },

  async sync(userId: string, localGroups: SyncedGroupData[]) {
    // Merge strategy: union of local and remote groups
    const remoteGroups = await this.pull(userId)
    const groupMap = new Map<string, SyncedGroupData>()

    // Add remote groups first
    for (const g of remoteGroups) {
      groupMap.set(g.groupId, g)
    }

    // Add/update with local groups (local wins for name, use earliest addedAt)
    for (const g of localGroups) {
      const existing = groupMap.get(g.groupId)

      if (existing) {
        groupMap.set(g.groupId, {
          ...g,
          addedAt: existing.addedAt < g.addedAt ? existing.addedAt : g.addedAt,
        })
        continue
      }

      groupMap.set(g.groupId, g)
    }

    const merged = Array.from(groupMap.values())

    // Save merged state
    await this.push(userId, merged)

    return merged
  },
}
