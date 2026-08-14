import { useSyncExternalStore } from 'react'

export const DEVICE_SAVED_VIEWS_KEY = 'spliit:saved-view-groups'
export const DEVICE_SAVED_VIEWS_MERGE_CHUNK = 100

export type DeviceSavedView = {
  groupId: string
  viewKey: string
  name: string
  memberCount: number
  lastOpenedAt: string
}

const listeners = new Set<() => void>()
const EMPTY: DeviceSavedView[] = []
let cachedRaw: string | null | undefined
let cachedViews: DeviceSavedView[] = EMPTY

function emit() {
  for (const listener of listeners) listener()
}

function isDeviceSavedView(value: unknown): value is DeviceSavedView {
  if (!value || typeof value !== 'object') return false
  const row = value as DeviceSavedView
  return (
    typeof row.groupId === 'string' &&
    row.groupId.length > 0 &&
    typeof row.viewKey === 'string' &&
    row.viewKey.length > 0 &&
    typeof row.name === 'string' &&
    typeof row.memberCount === 'number' &&
    Number.isFinite(row.memberCount) &&
    typeof row.lastOpenedAt === 'string'
  )
}

function cloneViews(items: DeviceSavedView[]): DeviceSavedView[] {
  return items.map((item) => ({ ...item }))
}

function compareRecency(a: DeviceSavedView, b: DeviceSavedView) {
  return (
    b.lastOpenedAt.localeCompare(a.lastOpenedAt) ||
    a.groupId.localeCompare(b.groupId)
  )
}

function sortByRecency(items: DeviceSavedView[]) {
  return cloneViews(items).sort(compareRecency)
}

export function subscribeDeviceSavedViews(listener: () => void) {
  listeners.add(listener)
  if (typeof window !== 'undefined' && listeners.size === 1) {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('storage', onStorage)
    }
  }
}

function onStorage(event: StorageEvent) {
  if (event.key === DEVICE_SAVED_VIEWS_KEY || event.key === null) {
    cachedRaw = undefined
    emit()
  }
}

export function readDeviceSavedViews(): DeviceSavedView[] {
  if (typeof window === 'undefined') return EMPTY
  const raw = window.localStorage.getItem(DEVICE_SAVED_VIEWS_KEY)
  if (raw === cachedRaw) return cachedViews
  cachedRaw = raw
  if (!raw) {
    cachedViews = EMPTY
    return cachedViews
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    cachedViews = Array.isArray(parsed)
      ? sortByRecency(parsed.filter(isDeviceSavedView))
      : EMPTY
  } catch {
    cachedViews = EMPTY
  }
  return cachedViews
}

function writeDeviceSavedViews(items: DeviceSavedView[]) {
  if (typeof window === 'undefined') return
  const sorted = sortByRecency(items)
  if (sorted.length === 0) {
    window.localStorage.removeItem(DEVICE_SAVED_VIEWS_KEY)
    cachedRaw = null
    cachedViews = EMPTY
  } else {
    const raw = JSON.stringify(sorted)
    window.localStorage.setItem(DEVICE_SAVED_VIEWS_KEY, raw)
    cachedRaw = raw
    cachedViews = sorted
  }
  emit()
}

export function isDeviceGroupSaved(groupId: string) {
  return readDeviceSavedViews().some((item) => item.groupId === groupId)
}

export function saveDeviceView(item: DeviceSavedView) {
  const rest = readDeviceSavedViews().filter(
    (entry) => entry.groupId !== item.groupId,
  )
  writeDeviceSavedViews([item, ...rest])
}

export function touchDeviceView(
  item: Omit<DeviceSavedView, 'lastOpenedAt'> & {
    lastOpenedAt?: string
  },
) {
  const items = readDeviceSavedViews()
  const index = items.findIndex((entry) => entry.groupId === item.groupId)
  if (index < 0) return false
  const next = items.slice()
  next[index] = {
    ...items[index],
    ...item,
    lastOpenedAt: item.lastOpenedAt ?? new Date().toISOString(),
  }
  writeDeviceSavedViews(next)
  return true
}

export function removeDeviceView(groupId: string) {
  writeDeviceSavedViews(
    readDeviceSavedViews().filter((entry) => entry.groupId !== groupId),
  )
}

export function clearDeviceSavedViews() {
  writeDeviceSavedViews([])
}

export function useDeviceSavedViews() {
  return useSyncExternalStore(
    subscribeDeviceSavedViews,
    readDeviceSavedViews,
    () => EMPTY,
  )
}
