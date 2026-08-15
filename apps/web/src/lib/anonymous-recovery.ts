import { getApiBaseUrl } from './api-url'
import { trackedFetch } from './connectivity'

const baseUrl = `${getApiBaseUrl()}/auth`

export type AnonymousRecoveryStatus = {
  isAnonymous: true
  hasRecoveryKey: boolean
  acknowledged: boolean
  onboardingCompleted: boolean
  canResumeSetup: boolean
}

export type AnonymousRecoveryKey = {
  code: string
  recoveryUrl: string
}

export type AnonymousRecoveryRotation = {
  recoveryUrl: string
  activationTicket: string
}

export class AnonymousRecoveryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly displayName?: string,
  ) {
    super(code)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await trackedFetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers,
  })
  const body = (await response.json().catch(() => ({}))) as {
    code?: string
    message?: string
    displayName?: string
  }
  if (!response.ok) {
    throw new AnonymousRecoveryError(
      body.code ?? body.message ?? 'ANONYMOUS_RECOVERY_FAILED',
      response.status,
      body.displayName,
    )
  }
  return body as T
}

export function getAnonymousRecoveryStatus() {
  return request<AnonymousRecoveryStatus>('/anonymous-recovery/status')
}

export function setupAnonymousRecovery() {
  return request<AnonymousRecoveryKey>('/anonymous-recovery/setup', {
    method: 'POST',
  })
}

export function acknowledgeAnonymousRecovery(input: {
  confirmedCopied: true
  code: string
}) {
  return request<{ success: true }>('/anonymous-recovery/acknowledge', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function startAnonymousRecoveryRotation() {
  return request<AnonymousRecoveryRotation>('/anonymous-recovery/rotate', {
    method: 'POST',
    body: JSON.stringify({ confirmed: true }),
  })
}

export function activateAnonymousRecoveryRotation(input: {
  activationTicket: string
  confirmedCopied: true
}) {
  return request<{ success: true }>('/anonymous-recovery/rotate/activate', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function replacePendingAnonymousRecovery() {
  return request<AnonymousRecoveryKey>('/anonymous-recovery/setup/replace', {
    method: 'POST',
    body: JSON.stringify({ confirmed: true }),
  })
}

const RECOVERY_KEY_PATTERN = /^spliit_anonymous_v1_[A-Za-z0-9_-]{43}$/

export function parseAnonymousRecoveryLink(value: string): string | null {
  const trimmed = value.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.pathname.replace(/\/$/, '') !== '/auth/recover') return null
  const code = new URLSearchParams(url.hash.replace(/^#/, '')).get('code')
  return code && RECOVERY_KEY_PATTERN.test(code) ? code : null
}

export function recoverAnonymousAccount(input: {
  code: string
  replaceCurrentSession?: boolean
}) {
  return request<{ success: true; alreadySignedIn?: boolean }>(
    '/sign-in/anonymous-recovery',
    { method: 'POST', body: JSON.stringify(input) },
  )
}
