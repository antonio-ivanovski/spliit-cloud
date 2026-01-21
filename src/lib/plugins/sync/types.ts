export type SyncedGroupData = {
  groupId: string
  groupName: string
  addedAt: Date
}

export interface SyncProvider {
  id: string
  name: string

  // Check if provider is configured (has required env vars)
  isConfigured(): boolean

  // Push local groups to provider
  push(userId: string, groups: SyncedGroupData[]): Promise<void>

  // Pull groups from provider
  pull(userId: string): Promise<SyncedGroupData[]>

  // Sync (push + pull with merge)
  sync(
    userId: string,
    localGroups: SyncedGroupData[],
  ): Promise<SyncedGroupData[]>
}
