import { describe, expect, it, vi } from 'vitest'

import { useCurrentAccount } from './use-current-account'
import { useOnboardingStatus } from './use-onboarding-status'

vi.mock('./use-current-account', () => ({
  useCurrentAccount: vi.fn(),
}))

const { mockStatusQuery, mockDisabledStatus } = vi.hoisted(() => ({
  mockStatusQuery: {
    data: undefined as { anonymousOnboardingCompleted: boolean } | undefined,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  // Real TanStack semantics for a disabled query: pending with no fetch.
  mockDisabledStatus: {
    data: undefined,
    isPending: true,
    isFetching: false,
    refetch: vi.fn(),
  },
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      onboardingStatus: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled === false ? mockDisabledStatus : mockStatusQuery,
      },
    },
  },
}))

function mockSession(account: Record<string, unknown> | null) {
  vi.mocked(useCurrentAccount).mockReturnValue({
    data: account as never,
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  })
  mockStatusQuery.data = undefined
  mockStatusQuery.isPending = false
  mockStatusQuery.isFetching = false
}

const guestEmail = 'guest-1@anonymous.placeholder.local'

describe('useOnboardingStatus', () => {
  it('flags the safeguard for a named guest the server still awaits', () => {
    mockSession({ name: 'New Guest', email: guestEmail, isAnonymous: true })
    mockStatusQuery.data = { anonymousOnboardingCompleted: false }

    const { needsSafeguard, needsProfile, needsOnboarding } =
      useOnboardingStatus()

    // The name-fallback alone would call this account done.
    expect(needsProfile).toBe(false)
    expect(needsSafeguard).toBe(true)
    expect(needsOnboarding).toBe(true)
  })

  it('clears the safeguard once the server reports completion', () => {
    mockSession({ name: 'New Guest', email: guestEmail, isAnonymous: true })
    mockStatusQuery.data = { anonymousOnboardingCompleted: true }

    const { needsSafeguard, needsOnboarding } = useOnboardingStatus()

    expect(needsSafeguard).toBe(false)
    expect(needsOnboarding).toBe(false)
  })

  it('honors an account-embedded flag without query data', () => {
    mockSession({
      name: 'New Guest',
      email: guestEmail,
      isAnonymous: true,
      anonymousOnboardingCompleted: false,
    })

    expect(useOnboardingStatus().needsSafeguard).toBe(true)
  })

  it('falls back to the name signal while the query is unresolved', () => {
    mockSession({ name: guestEmail, email: guestEmail, isAnonymous: true })
    mockStatusQuery.isPending = true
    mockStatusQuery.isFetching = true

    const status = useOnboardingStatus()

    expect(status.statusPending).toBe(true)
    expect(status.needsSafeguard).toBe(true)
  })

  it('falls back to the name signal when the query errored', () => {
    // Offline named guest: fail open to the old behavior; the gates bounce
    // on reconnect once the query succeeds.
    mockSession({ name: 'New Guest', email: guestEmail, isAnonymous: true })

    const { needsSafeguard } = useOnboardingStatus()

    expect(needsSafeguard).toBe(false)
  })

  it('never flags the safeguard for ordinary accounts', () => {
    mockSession({ name: 'Alice', email: 'alice@example.com' })

    const { needsSafeguard, needsOnboarding, statusPending } =
      useOnboardingStatus()

    expect(needsSafeguard).toBe(false)
    expect(needsOnboarding).toBe(false)
    // The query is disabled for non-anonymous accounts: a raw `isPending`
    // would hold the spinner forever, so it must not count as pending.
    expect(statusPending).toBe(false)
  })

  it('reports pending while the enabled query fetches', () => {
    mockSession({ name: guestEmail, email: guestEmail, isAnonymous: true })
    mockStatusQuery.isPending = true
    mockStatusQuery.isFetching = true

    expect(useOnboardingStatus().statusPending).toBe(true)
  })
})
