import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addPasskey,
  getPasskeySessionFreshness,
  isPasskeySupported,
  isSessionFreshForPasskeyRegistration,
  listPasskeys,
  markPasskeyAsLastUsedLoginMethod,
  notifyPasskeyChanged,
  removePasskey,
  renamePasskey,
  signOutAndReturnToSignIn,
  type PasskeyError,
} from './passkey'

const {
  mockAdd,
  mockList,
  mockDeletePasskey,
  mockRenamePasskey,
  mockAfterPasskeyChange,
  mockGetSession,
  mockSignOut,
  mockReplaceLocation,
  mockClearLastAccount,
} = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockList: vi.fn(),
  mockDeletePasskey: vi.fn(),
  mockRenamePasskey: vi.fn(),
  mockAfterPasskeyChange: vi.fn(),
  mockGetSession: vi.fn(),
  mockSignOut: vi.fn(),
  mockReplaceLocation: vi.fn(),
  mockClearLastAccount: vi.fn(),
}))

vi.mock('./auth', () => ({
  authClient: {
    passkey: {
      addPasskey: mockAdd,
      listUserPasskeys: mockList,
    },
    getSession: mockGetSession,
    signOut: mockSignOut,
  },
}))

vi.mock('./browser-navigation', () => ({
  replaceBrowserLocation: mockReplaceLocation,
}))

vi.mock('./last-account', () => ({
  clearLastAccount: mockClearLastAccount,
}))

vi.mock('@/trpc/client', () => ({
  getTrpcClient: () => ({
    account: {
      deletePasskey: { mutate: mockDeletePasskey },
      renamePasskey: { mutate: mockRenamePasskey },
      afterPasskeyChange: { mutate: mockAfterPasskeyChange },
    },
  }),
}))

describe('passkey lib', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports no WebAuthn support without PublicKeyCredential', () => {
    expect(isPasskeySupported()).toBe(false)
  })

  it('lists passkeys with only UI fields and surfaces failures', async () => {
    mockList.mockResolvedValueOnce({
      data: [
        {
          id: 'pk-1',
          name: 'MacBook',
          publicKey: 'secret-material',
          userId: 'acct-1',
          credentialID: 'cred-1',
          counter: 3,
          deviceType: 'singleDevice',
          backedUp: false,
          transports: 'internal',
          createdAt: '2026-09-01T00:00:00.000Z',
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      ],
      error: null,
    })
    await expect(listPasskeys()).resolves.toEqual([
      {
        id: 'pk-1',
        name: 'MacBook',
        createdAt: '2026-09-01T00:00:00.000Z',
        deviceType: 'singleDevice',
        backedUp: false,
      },
    ])

    mockList.mockResolvedValueOnce({
      data: null,
      error: { code: 'FAIL', status: 500 },
    })
    await expect(listPasskeys()).rejects.toMatchObject({
      code: 'FAIL',
    } as Partial<PasskeyError>)
  })

  it('trims the passkey name when registering', async () => {
    mockAdd.mockResolvedValueOnce({ data: { id: 'pk-1' }, error: null })
    await addPasskey('  MacBook  ')
    expect(mockAdd).toHaveBeenCalledWith({ name: 'MacBook' })

    mockAdd.mockResolvedValueOnce({ data: { id: 'pk-2' }, error: null })
    await addPasskey('   ')
    expect(mockAdd).toHaveBeenCalledWith(undefined)
  })

  it('renames the Spliit-side nickname and maps failures', async () => {
    mockRenamePasskey.mockResolvedValueOnce({ success: true })
    await expect(renamePasskey('pk-1', 'MacBook')).resolves.toBeUndefined()
    expect(mockRenamePasskey).toHaveBeenCalledWith({
      id: 'pk-1',
      name: 'MacBook',
    })

    mockRenamePasskey.mockRejectedValueOnce(new Error('NOT_FOUND'))
    await expect(renamePasskey('pk-1', 'MacBook')).rejects.toMatchObject({
      code: 'PASSKEY_RENAME_FAILED',
    } as Partial<PasskeyError>)
  })

  it('maps a stale-session registration failure to PASSKEY_SESSION_STALE', async () => {
    mockAdd.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'SESSION_NOT_FRESH',
        message: 'Session is not fresh',
        status: 403,
      },
    })
    await expect(addPasskey('MacBook')).rejects.toMatchObject({
      code: 'PASSKEY_SESSION_STALE',
      status: 403,
    } as Partial<PasskeyError>)
  })

  it('evaluates session freshness against the server window', () => {
    const now = new Date('2026-09-22T09:00:00.000Z').getTime()
    const day = 24 * 60 * 60 * 1000
    const freshAge = 30 * 24 * 60 * 60

    expect(
      isSessionFreshForPasskeyRegistration(
        new Date(now - day).toISOString(),
        freshAge,
        now,
      ),
    ).toBe(true)
    expect(
      isSessionFreshForPasskeyRegistration(
        new Date(now - 31 * day).toISOString(),
        freshAge,
        now,
      ),
    ).toBe(false)
    // Boundary is exclusive: exactly at the window counts as stale, matching
    // the server (`Date.now() - createdAt >= freshAge` rejects).
    expect(
      isSessionFreshForPasskeyRegistration(
        new Date(now - 30 * day).toISOString(),
        freshAge,
        now,
      ),
    ).toBe(false)
    // Unknown timestamps proceed — the server is the source of truth.
    expect(isSessionFreshForPasskeyRegistration(null, freshAge, now)).toBe(true)
    expect(isSessionFreshForPasskeyRegistration(undefined, freshAge, now)).toBe(
      true,
    )
    expect(
      isSessionFreshForPasskeyRegistration('not-a-date', freshAge, now),
    ).toBe(true)
  })

  it('fails the freshness probe open without a usable window', () => {
    const now = Date.now()
    const createdAt = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString()
    // Rolling-deploy skew: the server may not know the field yet.
    expect(
      isSessionFreshForPasskeyRegistration(
        createdAt,
        undefined as unknown as number,
        now,
      ),
    ).toBe(true)
    expect(isSessionFreshForPasskeyRegistration(createdAt, NaN, now)).toBe(true)
    // `0` disables the server check, so it counts as always fresh.
    expect(isSessionFreshForPasskeyRegistration(createdAt, 0, now)).toBe(true)
    expect(isSessionFreshForPasskeyRegistration(createdAt, -1, now)).toBe(true)
  })

  it('probes session freshness without ever throwing', async () => {
    const freshAge = 30 * 24 * 60 * 60
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: { createdAt: new Date(Date.now() - 1000).toISOString() },
      },
      error: null,
    })
    await expect(getPasskeySessionFreshness(freshAge)).resolves.toBe(true)

    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          createdAt: new Date(
            Date.now() - 31 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      },
      error: null,
    })
    await expect(getPasskeySessionFreshness(freshAge)).resolves.toBe(false)

    mockGetSession.mockRejectedValueOnce(new Error('offline'))
    await expect(getPasskeySessionFreshness(freshAge)).resolves.toBe(true)

    mockGetSession.mockResolvedValueOnce({ data: null, error: null })
    await expect(getPasskeySessionFreshness(freshAge)).resolves.toBe(true)
  })

  it('signs out and returns to sign-in with the current page preserved', async () => {
    const replace = vi.fn()
    vi.stubGlobal('window', {
      location: {
        pathname: '/account',
        search: '?tab=security',
        hash: '',
        replace,
      },
    })
    try {
      mockSignOut.mockResolvedValueOnce({
        data: { success: true },
        error: null,
      })
      await signOutAndReturnToSignIn()
      expect(mockSignOut).toHaveBeenCalledOnce()
      // The cached snapshot is cleared before navigating so the landing
      // page cannot render signed-in from cache.
      expect(mockClearLastAccount).toHaveBeenCalledOnce()
      expect(mockClearLastAccount.mock.invocationCallOrder[0]).toBeLessThan(
        mockReplaceLocation.mock.invocationCallOrder[0],
      )
      expect(mockReplaceLocation).toHaveBeenCalledWith(
        '/?redirect=%2Faccount%3Ftab%3Dsecurity',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports a post-sign-out navigation failure distinctly', async () => {
    vi.stubGlobal('window', {
      location: { pathname: '/account', search: '', hash: '' },
    })
    try {
      mockSignOut.mockResolvedValueOnce({
        data: { success: true },
        error: null,
      })
      mockReplaceLocation.mockImplementationOnce(() => {
        throw new Error('blocked')
      })
      await expect(signOutAndReturnToSignIn()).rejects.toMatchObject({
        code: 'PASSKEY_REAUTH_NAVIGATE_FAILED',
      } as Partial<PasskeyError>)
      expect(mockClearLastAccount).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('surfaces sign-out failures instead of navigating away', async () => {
    mockSignOut.mockResolvedValueOnce({
      data: null,
      error: { code: 'FAIL', message: 'nope' },
    })
    await expect(signOutAndReturnToSignIn()).rejects.toMatchObject({
      code: 'PASSKEY_SIGN_OUT_FAILED',
    } as Partial<PasskeyError>)
    expect(mockReplaceLocation).not.toHaveBeenCalled()
  })

  it('removes passkeys through the guarded tRPC mutation', async () => {
    mockDeletePasskey.mockResolvedValueOnce({ success: true })
    await expect(removePasskey('pk-1')).resolves.toBeUndefined()
    expect(mockDeletePasskey).toHaveBeenCalledWith({ id: 'pk-1' })
  })

  it('maps a last-sign-in-method conflict to PASSKEY_LAST_METHOD', async () => {
    mockDeletePasskey.mockRejectedValueOnce({ data: { code: 'CONFLICT' } })
    await expect(removePasskey('pk-1')).rejects.toMatchObject({
      code: 'PASSKEY_LAST_METHOD',
    } as Partial<PasskeyError>)

    mockDeletePasskey.mockRejectedValueOnce({ data: { code: 'NOT_FOUND' } })
    await expect(removePasskey('pk-1')).rejects.toMatchObject({
      code: 'PASSKEY_REMOVE_FAILED',
    } as Partial<PasskeyError>)
  })

  it('records passkey as the last used login method for the login hint', () => {
    // Node project (see vitest.config.ts): stub the DOM globals.
    const jar: string[] = []
    vi.stubGlobal('document', {
      get cookie() {
        return jar.join('; ')
      },
      set cookie(value: string) {
        jar.push(value)
      },
    })
    vi.stubGlobal('window', { location: { protocol: 'http:' } })
    try {
      markPasskeyAsLastUsedLoginMethod()
      expect(jar.join('; ')).toContain(
        'better-auth.last_used_login_method=passkey; path=/; max-age=2592000; samesite=lax',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('pings after passkey changes without failing the caller', async () => {
    mockAfterPasskeyChange.mockResolvedValueOnce({ success: true })
    await expect(notifyPasskeyChanged()).resolves.toBeUndefined()
    expect(mockAfterPasskeyChange).toHaveBeenCalledWith()

    mockAfterPasskeyChange.mockRejectedValueOnce(new Error('offline'))
    await expect(notifyPasskeyChanged()).resolves.toBeUndefined()
  })
})
