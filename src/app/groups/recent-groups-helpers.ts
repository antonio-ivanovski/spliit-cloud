import { z } from 'zod'

export const recentGroupsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string(),
  }),
)

export const starredGroupsSchema = z.array(z.string())
export const archivedGroupsSchema = z.array(z.string())

export type RecentGroups = z.infer<typeof recentGroupsSchema>
export type RecentGroup = RecentGroups[number]
export type RecentGroupsListener = (groups: RecentGroups) => void

const STORAGE_KEY = 'recentGroups'
const STARRED_GROUPS_STORAGE_KEY = 'starredGroups'
const ARCHIVED_GROUPS_STORAGE_KEY = 'archivedGroups'
const recentGroupsListeners = new Set<RecentGroupsListener>()

function notifyRecentGroupsChange(groups: RecentGroups) {
  recentGroupsListeners.forEach((listener) => {
    listener(groups)
  })
}

export function onRecentGroupsChange(listener: RecentGroupsListener) {
  if (typeof window === 'undefined') return () => {}
  recentGroupsListeners.add(listener)
  return () => {
    recentGroupsListeners.delete(listener)
  }
}

export function getRecentGroups() {
  if (typeof localStorage === 'undefined') return []
  const groupsInStorageJson = localStorage.getItem(STORAGE_KEY)
  const groupsInStorageRaw = groupsInStorageJson
    ? JSON.parse(groupsInStorageJson)
    : []
  const parseResult = recentGroupsSchema.safeParse(groupsInStorageRaw)
  return parseResult.success ? parseResult.data : []
}

export function setRecentGroups(groups: RecentGroups) {
  if (typeof localStorage === 'undefined') return
  const parseResult = recentGroupsSchema.safeParse(groups)
  const nextGroups = parseResult.success ? parseResult.data : []
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextGroups))
  notifyRecentGroupsChange(nextGroups)
}

export function saveRecentGroup(group: RecentGroup) {
  const recentGroups = getRecentGroups()
  setRecentGroups([group, ...recentGroups.filter((rg) => rg.id !== group.id)])
}

export function deleteRecentGroup(group: RecentGroup) {
  const recentGroups = getRecentGroups()
  setRecentGroups(recentGroups.filter((rg) => rg.id !== group.id))
}

export function getStarredGroups() {
  if (typeof localStorage === 'undefined') return []
  const starredGroupsJson = localStorage.getItem(STARRED_GROUPS_STORAGE_KEY)
  const starredGroupsRaw = starredGroupsJson
    ? JSON.parse(starredGroupsJson)
    : []
  const parseResult = starredGroupsSchema.safeParse(starredGroupsRaw)
  return parseResult.success ? parseResult.data : []
}

export function starGroup(groupId: string) {
  if (typeof localStorage === 'undefined') return
  const starredGroups = getStarredGroups()
  localStorage.setItem(
    STARRED_GROUPS_STORAGE_KEY,
    JSON.stringify([...starredGroups, groupId]),
  )
  notifyRecentGroupsChange(getRecentGroups())
}

export function unstarGroup(groupId: string) {
  if (typeof localStorage === 'undefined') return
  const starredGroups = getStarredGroups()
  localStorage.setItem(
    STARRED_GROUPS_STORAGE_KEY,
    JSON.stringify(starredGroups.filter((g) => g !== groupId)),
  )
  notifyRecentGroupsChange(getRecentGroups())
}

export function getArchivedGroups() {
  if (typeof localStorage === 'undefined') return []
  const archivedGroupsJson = localStorage.getItem(ARCHIVED_GROUPS_STORAGE_KEY)
  const archivedGroupsRaw = archivedGroupsJson
    ? JSON.parse(archivedGroupsJson)
    : []
  const parseResult = archivedGroupsSchema.safeParse(archivedGroupsRaw)
  return parseResult.success ? parseResult.data : []
}

export function archiveGroup(groupId: string) {
  if (typeof localStorage === 'undefined') return
  const archivedGroups = getArchivedGroups()
  localStorage.setItem(
    ARCHIVED_GROUPS_STORAGE_KEY,
    JSON.stringify([...archivedGroups, groupId]),
  )
  notifyRecentGroupsChange(getRecentGroups())
}

export function unarchiveGroup(groupId: string) {
  if (typeof localStorage === 'undefined') return
  const archivedGroups = getArchivedGroups()
  localStorage.setItem(
    ARCHIVED_GROUPS_STORAGE_KEY,
    JSON.stringify(archivedGroups.filter((g) => g !== groupId)),
  )
  notifyRecentGroupsChange(getRecentGroups())
}
