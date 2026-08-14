import { getApiBaseUrl } from './api-url'

const baseUrl = `${getApiBaseUrl()}/auth`

export class EmailChangeError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
  }
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    code?: string
    message?: string
  }
  if (!response.ok) {
    throw new EmailChangeError(
      payload.code ?? payload.message ?? 'EMAIL_CHANGE_FAILED',
      response.status,
    )
  }
  return payload as T
}

export function requestEmailChange(input: {
  email: string
  acknowledgedGraduation?: boolean
}) {
  return request<{ sent: true }>('/email/request-change', input)
}

export function confirmEmailChange(input: { email: string; otp: string }) {
  return request<{
    success: true
    email: string
    isAnonymous: boolean
  }>('/email/confirm-change', input)
}
