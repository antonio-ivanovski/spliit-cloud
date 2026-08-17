import type { AuthAccount } from '@/lib/auth'

const LAST_ACCOUNT_KEY = 'spliit:last-account'

type LastAccountSnapshot = {
  id: string
  name: string
  email: string
  image: string | null
  emailVerified: boolean
  isAnonymous?: boolean | null
  anonymousOnboardingCompleted?: boolean | null
  createdAt: string
  updatedAt: string
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function parseSnapshot(raw: string): AuthAccount | null {
  try {
    const value = JSON.parse(raw) as Partial<LastAccountSnapshot>
    if (
      typeof value.id !== 'string' ||
      typeof value.name !== 'string' ||
      typeof value.email !== 'string'
    ) {
      return null
    }
    const account: AuthAccount = {
      id: value.id,
      name: value.name,
      email: value.email,
      image: value.image ?? null,
      emailVerified: value.emailVerified === true,
      isAnonymous: value.isAnonymous,
      createdAt: value.createdAt ? new Date(value.createdAt) : new Date(0),
      updatedAt: value.updatedAt ? new Date(value.updatedAt) : new Date(0),
    }
    if (typeof value.anonymousOnboardingCompleted === 'boolean') {
      account.anonymousOnboardingCompleted = value.anonymousOnboardingCompleted
    }
    return account
  } catch {
    return null
  }
}

export function writeLastAccount(account: AuthAccount) {
  const snapshot: LastAccountSnapshot = {
    id: account.id,
    name: account.name,
    email: account.email,
    image: account.image ?? null,
    emailVerified: account.emailVerified,
    isAnonymous: account.isAnonymous,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  }
  if (typeof account.anonymousOnboardingCompleted === 'boolean') {
    snapshot.anonymousOnboardingCompleted = account.anonymousOnboardingCompleted
  }
  localStorageOrNull()?.setItem(LAST_ACCOUNT_KEY, JSON.stringify(snapshot))
}

export function clearLastAccount() {
  localStorageOrNull()?.removeItem(LAST_ACCOUNT_KEY)
  sessionStorageOrNull()?.removeItem(LAST_ACCOUNT_KEY)
}

export function readLastAccount(): AuthAccount | null {
  const local = localStorageOrNull()
  const session = sessionStorageOrNull()
  const localRaw = local?.getItem(LAST_ACCOUNT_KEY)
  if (localRaw) return parseSnapshot(localRaw)

  const sessionRaw = session?.getItem(LAST_ACCOUNT_KEY)
  session?.removeItem(LAST_ACCOUNT_KEY)
  if (!sessionRaw) return null

  const account = parseSnapshot(sessionRaw)
  if (account) local?.setItem(LAST_ACCOUNT_KEY, sessionRaw)
  return account
}
