import { describe, expect, it, vi } from 'vitest'

import {
  addPasskey,
  isPasskeySupported,
  listPasskeys,
  markPasskeyAsLastUsedLoginMethod,
  notifyPasskeyChanged,
  removePasskey,
  type PasskeyError,
} from './passkey'

const { mockAdd, mockList, mockDeletePasskey, mockAfterPasskeyChange } =
  vi.hoisted(() => ({
    mockAdd: vi.fn(),
    mockList: vi.fn(),
    mockDeletePasskey: vi.fn(),
    mockAfterPasskeyChange: vi.fn(),
  }))

vi.mock('./auth', () => ({
  authClient: {
    passkey: {
      addPasskey: mockAdd,
      listUserPasskeys: mockList,
    },
  },
}))

vi.mock('@/trpc/client', () => ({
  getTrpcClient: () => ({
    account: {
      deletePasskey: { mutate: mockDeletePasskey },
      afterPasskeyChange: { mutate: mockAfterPasskeyChange },
    },
  }),
}))

describe('passkey lib', () => {
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
