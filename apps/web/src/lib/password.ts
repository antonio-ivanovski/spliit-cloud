import { getApiBaseUrl } from './api-url'

const baseUrl = `${getApiBaseUrl()}/auth`

export class PasswordError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  fallbackCode: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  const payload = (await response.json().catch(() => ({}))) as {
    code?: string
    message?: string
  }
  if (!response.ok) {
    throw new PasswordError(
      payload.code ?? payload.message ?? fallbackCode,
      response.status,
    )
  }
  return payload as T
}

export function getPasswordStatus() {
  return request<{ hasPassword: boolean }>(
    '/password/status',
    { method: 'GET' },
    'PASSWORD_STATUS_FAILED',
  )
}

export function setPassword(newPassword: string) {
  return request<{ success: true }>(
    '/password/set',
    { method: 'POST', body: JSON.stringify({ newPassword }) },
    'PASSWORD_SET_FAILED',
  )
}

export function removePassword(input: { currentPassword: string }) {
  return request<{ success: true }>(
    '/password/remove',
    {
      method: 'POST',
      body: JSON.stringify({ currentPassword: input.currentPassword }),
    },
    'PASSWORD_REMOVE_FAILED',
  )
}

export function changePassword(input: {
  currentPassword: string
  newPassword: string
  revokeOtherSessions?: boolean
}) {
  return request<{ token: string | null }>(
    '/change-password',
    {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: input.revokeOtherSessions ?? true,
      }),
    },
    'PASSWORD_CHANGE_FAILED',
  )
}
