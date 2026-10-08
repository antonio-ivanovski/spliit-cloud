import { useOnlineStatus } from '@/lib/use-online-status'

export type RemoteControlReason = 'offline' | 'busy' | null

/**
 * Shared disabled state for remote-write controls.
 *
 * Centralizes the pattern previously repeated across account settings:
 * `disabled = offline || !ready || busy || extraDisabled`.
 *
 * - `offline` derives from `useOnlineStatus()`, which fails open on `transport:
 *   unknown` so controls stay enabled during boot (no flicker).
 * - `ready` covers async readiness (e.g. `updater === null || updater.ready`).
 *   Defaults to true.
 * - `busy` covers in-flight saves (e.g. `updater?.isUpdating`). Defaults to
 *   false.
 * - `extraDisabled` folds a control-specific condition (e.g. `!draftDirty`).
 *
 * Local-only presentation controls (theme, locale, mascot pin) must NOT use
 * this hook — they apply immediately offline via `patchPreferences` and stay
 * enabled by design. Use this only for remote writes with no local-only meaning
 * (AI toggles, notification channels, destructive-confirmation level, group-tab
 * customization, webhooks, authorized clients, ...).
 */
export function useRemoteControlState(
  options: { ready?: boolean; busy?: boolean; extraDisabled?: boolean } = {},
): {
  disabled: boolean
  reason: RemoteControlReason
  offline: boolean
} {
  const isOnline = useOnlineStatus()
  const { ready = true, busy = false, extraDisabled = false } = options
  const offline = !isOnline
  if (offline) return { disabled: true, reason: 'offline', offline }
  if (!ready || busy || extraDisabled)
    return { disabled: true, reason: 'busy', offline }
  return { disabled: false, reason: null, offline }
}

/**
 * Shared query gate for connection-required reads. Preserves the existing
 * `enabled: isOnline` semantics (fails open on unknown transport) while folding
 * an extra condition without repeating `useOnlineStatus` at every call site.
 */
export function useOfflineQueryEnabled(extraEnabled = true): boolean {
  const isOnline = useOnlineStatus()
  return isOnline && extraEnabled
}

/**
 * Section-level connection gate: true when offline and no data is available to
 * render. Replaces the repeated `!isOnline && !data` early-returns in settings
 * sections.
 */
export function useConnectionRequired(hasData: boolean): boolean {
  const isOnline = useOnlineStatus()
  return !isOnline && !hasData
}
