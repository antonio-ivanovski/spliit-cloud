import { getTrpcClient } from '@/trpc/client'

import { authClient } from './auth'

export type PasskeyInfo = {
  id: string
  name?: string | null
  createdAt: string | Date
  deviceType?: string | null
  backedUp?: boolean | null
}

export class PasskeyError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
  }
}

function toPasskeyError(
  error: { code?: string; message?: string; status?: number } | null,
  fallbackCode: string,
): PasskeyError {
  return new PasskeyError(
    error?.code ?? error?.message ?? fallbackCode,
    error?.status ?? 0,
  )
}

/**
 * Whether this browser can use WebAuthn passkeys at all. Conditional UI
 * (autofill) support is probed separately at the call site.
 */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
  )
}

type PasskeyRow = {
  id: string
  name?: string | null
  createdAt: string | Date
  deviceType?: string | null
  backedUp?: boolean | null
}

export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const result = await authClient.passkey.listUserPasskeys()
  if (result.error) {
    throw toPasskeyError(result.error, 'PASSKEY_LIST_FAILED')
  }
  // The endpoint returns full credential rows (including publicKey). Pick
  // only what the UI renders so key material never sits in client state.
  return ((result.data ?? []) as PasskeyRow[]).map((row) => ({
    id: row.id,
    name: row.name ?? null,
    createdAt: row.createdAt,
    deviceType: row.deviceType ?? null,
    backedUp: row.backedUp ?? null,
  }))
}

export async function addPasskey(name?: string): Promise<PasskeyInfo> {
  const trimmed = name?.trim()
  const result = await authClient.passkey.addPasskey(
    trimmed ? { name: trimmed } : undefined,
  )
  if (result.error || !result.data) {
    throw toPasskeyError(result.error, 'PASSKEY_ADD_FAILED')
  }
  return result.data as PasskeyInfo
}

/**
 * Delete a passkey through the `account.deletePasskey` tRPC mutation — never
 * through `authClient.passkey.deletePasskey`. Only the mutation enforces the
 * last-sign-in-method guard (the plugin endpoint deletes through the raw
 * adapter and cannot run the check). CONFLICT maps to PASSKEY_LAST_METHOD.
 */
export async function removePasskey(id: string): Promise<void> {
  try {
    await getTrpcClient().account.deletePasskey.mutate({ id })
  } catch (error) {
    throw toDeletePasskeyError(error)
  }
}

function toDeletePasskeyError(error: unknown): PasskeyError {
  const code =
    typeof error === 'object' && error !== null && 'data' in error
      ? (error as { data?: { code?: unknown } }).data?.code
      : undefined
  if (code === 'CONFLICT') {
    return new PasskeyError('PASSKEY_LAST_METHOD', 409)
  }
  return new PasskeyError('PASSKEY_REMOVE_FAILED', 0)
}

/**
 * Cookie name the better-auth `lastLoginMethod` plugin reads through
 * `getLastUsedLoginMethod()` (`lastLoginMethodClient()` with no custom config).
 * The plugin only writes it on sign-in responses, so registering a passkey
 * during anonymous onboarding leaves the login-screen hint stuck at `anonymous`
 * — the account's actual credential is the passkey.
 */
const LAST_USED_LOGIN_METHOD_COOKIE = 'better-auth.last_used_login_method'
const LAST_USED_LOGIN_METHOD_MAX_AGE = 30 * 24 * 60 * 60

/**
 * Record `passkey` as the last used login method so the login screen shows its
 * "Last used" hint on the passkey button. Mirrors the plugin's cookie
 * attributes (root path, 30d max-age, JS-readable). Scoped to the anonymous
 * onboarding flow — settings-flow additions leave the hint alone.
 */
export function markPasskeyAsLastUsedLoginMethod(): void {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `${LAST_USED_LOGIN_METHOD_COOKIE}=passkey; path=/; max-age=${LAST_USED_LOGIN_METHOD_MAX_AGE}; samesite=lax${secure}`
}

/**
 * Tell the API a passkey was added (or removed) outside tRPC so the 30s account
 * cache is busted and the anonymous gate flips immediately. Best-effort: the
 * credential change already succeeded — never fail the caller's success flow
 * when only this ping fails.
 */
export function notifyPasskeyChanged(): Promise<void> {
  return getTrpcClient()
    .account.afterPasskeyChange.mutate()
    .then(() => undefined)
    .catch(() => undefined)
}
