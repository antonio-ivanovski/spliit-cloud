import { describe, expect, it } from 'vitest'

import { Prisma } from '@spliit/db'

import '../../../test/mocks'
import {
  clearAccountCache,
  getCachedAccount,
} from '../../../lib/auth/account-cache'
import { env } from '../../../lib/env'
import { authState, prisma$QueryRaw, prismaMock } from '../../../test/state'
import { createTRPCContext } from '../../init'
import { accountRouter } from './index'

function makeCaller(authUserId: string, user?: Record<string, unknown>) {
  return accountRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
        ...user,
      },
    },
  } as never)
}

function makeAnonymousCaller() {
  return accountRouter.createCaller({ auth: null } as never)
}

async function authAs(userId: string) {
  authState.session = {
    user: { id: userId },
    session: { id: 'sess-1' },
  }
  prismaMock.user.findUnique.mockImplementation(async (args: unknown) => {
    const id = (args as { where: { id: string } }).where.id
    return {
      id,
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    }
  })
  return createTRPCContext({
    req: new Request('http://localhost/api/test'),
  })
}

function mockGroupWithMembership(
  userId: string,
  groups: Array<{
    id: string
    archived: boolean
    role: 'ADMIN' | 'MEMBER'
    members: number
    preferences?: Partial<{
      starred: boolean
      hidden: boolean
    }>
  }>,
) {
  prismaMock.groupMember.findMany.mockResolvedValue(
    groups.map((g) => ({
      groupId: g.id,
      accountId: userId,
      role: g.role,
      status: 'ACTIVE',
      group: {
        id: g.id,
        name: `Group ${g.id}`,
        information: null,
        archived: g.archived,
        createdAt: new Date(),
        ledger: {
          id: `ledger-${g.id}`,
          currency: '$',
          currencyCode: 'USD',
        },
        _count: { members: g.members },
      },
    })) as never,
  )
  const prefs = groups
    .filter((g) => g.preferences)
    .map((g) => ({
      groupId: g.id,
      starred: false,
      hidden: false,
      ...g.preferences,
    }))
  prismaMock.accountGroupPreference.findMany.mockResolvedValue(prefs as never)
  prismaMock.expense.groupBy.mockResolvedValue([] as never)
}

describe('accountRouter account preferences', () => {
  it('requires authentication', async () => {
    await expect(makeAnonymousCaller().getPreferences()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  it('returns an unset preference shape when no row exists', async () => {
    prismaMock.accountPreference.findUnique.mockResolvedValue(null)

    await expect(makeCaller('acct-1').getPreferences()).resolves.toEqual({
      preferences: {
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
        mascot: 'bill',
        notificationsEnabled: true,
        aiFeaturesEnabled: true,
        aiCategoryExtractEnabled: true,
        aiReceiptScanEnabled: true,
        aiVoiceExpenseEnabled: true,
      },
    })
  })

  it('initializes each device value only while its field is null', async () => {
    prismaMock.accountPreference.findUnique.mockResolvedValue({
      defaultCurrencyCode: 'USD',
      timeZone: 'Europe/Skopje',
      locale: 'mk-MK',
      theme: 'dark',
      mascot: 'off',
    } as never)

    const result = await makeCaller('acct-1').initializePreferences({
      locale: 'mk-MK',
      theme: 'dark',
      timeZone: 'Europe/Skopje',
    })

    expect(prismaMock.accountPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'acct-1' },
        create: expect.objectContaining({
          accountId: 'acct-1',
          locale: 'mk-MK',
          theme: 'dark',
          timeZone: 'Europe/Skopje',
        }),
        update: {},
      }),
    )
    expect(prismaMock.accountPreference.updateMany).toHaveBeenCalledWith({
      where: { accountId: 'acct-1', locale: null },
      data: { locale: 'mk-MK' },
    })
    expect(prismaMock.accountPreference.updateMany).toHaveBeenCalledWith({
      where: { accountId: 'acct-1', theme: null },
      data: { theme: 'dark' },
    })
    expect(prismaMock.accountPreference.updateMany).toHaveBeenCalledWith({
      where: { accountId: 'acct-1', timeZone: null },
      data: { timeZone: 'Europe/Skopje' },
    })
    expect(result.preferences).toEqual({
      defaultCurrencyCode: 'USD',
      timeZone: 'Europe/Skopje',
      locale: 'mk-MK',
      theme: 'dark',
      mascot: 'off',
      notificationsEnabled: true,
      aiFeaturesEnabled: true,
      aiCategoryExtractEnabled: true,
      aiReceiptScanEnabled: true,
      aiVoiceExpenseEnabled: true,
    })
  })

  it('infers the most common supported currency from active admin groups', async () => {
    prismaMock.accountPreference.findUnique
      .mockResolvedValueOnce({
        defaultCurrencyCode: null,
        timeZone: 'UTC',
        locale: 'en-US',
        theme: 'system',
      } as never)
      .mockResolvedValueOnce({
        defaultCurrencyCode: 'EUR',
        timeZone: 'UTC',
        locale: 'en-US',
        theme: 'system',
      } as never)
    prismaMock.groupMember.findMany.mockResolvedValue([
      {
        role: 'ADMIN',
        group: {
          createdAt: new Date('2026-01-01'),
          ledger: { currencyCode: 'EUR' },
        },
      },
      {
        role: 'ADMIN',
        group: {
          createdAt: new Date('2026-02-01'),
          ledger: { currencyCode: 'EUR' },
        },
      },
      {
        role: 'ADMIN',
        group: {
          createdAt: new Date('2026-03-01'),
          ledger: { currencyCode: 'USD' },
        },
      },
    ] as never)

    const result = await makeCaller('acct-1').initializePreferences({})

    expect(prismaMock.groupMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: 'acct-1',
          status: 'ACTIVE',
          group: { archived: false },
        },
      }),
    )
    expect(prismaMock.accountPreference.updateMany).toHaveBeenCalledWith({
      where: {
        accountId: 'acct-1',
        defaultCurrencyCode: null,
      },
      data: { defaultCurrencyCode: 'EUR' },
    })
    expect(result.preferences.defaultCurrencyCode).toBe('EUR')
  })

  it('breaks currency-frequency ties using the newest admin group', async () => {
    prismaMock.accountPreference.findUnique
      .mockResolvedValueOnce({
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
      } as never)
      .mockResolvedValueOnce({
        defaultCurrencyCode: 'USD',
        timeZone: null,
        locale: null,
        theme: null,
      } as never)
    prismaMock.groupMember.findMany.mockResolvedValue([
      {
        role: 'ADMIN',
        group: {
          createdAt: new Date('2026-01-01'),
          ledger: { currencyCode: 'EUR' },
        },
      },
      {
        role: 'ADMIN',
        group: {
          createdAt: new Date('2026-02-01'),
          ledger: { currencyCode: 'USD' },
        },
      },
    ] as never)

    await makeCaller('acct-1').initializePreferences({})

    expect(prismaMock.accountPreference.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { defaultCurrencyCode: 'USD' },
      }),
    )
  })

  it('uses member currencies only when there is no supported admin currency', async () => {
    prismaMock.accountPreference.findUnique
      .mockResolvedValueOnce({
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
      } as never)
      .mockResolvedValueOnce({
        defaultCurrencyCode: 'GBP',
        timeZone: null,
        locale: null,
        theme: null,
      } as never)
    prismaMock.groupMember.findMany.mockResolvedValue([
      {
        role: 'ADMIN',
        group: {
          createdAt: new Date('2026-03-01'),
          ledger: { currencyCode: null },
        },
      },
      {
        role: 'MEMBER',
        group: {
          createdAt: new Date('2026-02-01'),
          ledger: { currencyCode: 'GBP' },
        },
      },
      {
        role: 'MEMBER',
        group: {
          createdAt: new Date('2026-01-01'),
          ledger: { currencyCode: 'GBP' },
        },
      },
    ] as never)

    await makeCaller('acct-1').initializePreferences({})

    expect(prismaMock.accountPreference.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { defaultCurrencyCode: 'GBP' },
      }),
    )
  })

  it('falls back to the USD instance currency when groups have no ISO currency', async () => {
    prismaMock.accountPreference.findUnique
      .mockResolvedValueOnce({
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
      } as never)
      .mockResolvedValueOnce({
        defaultCurrencyCode: 'USD',
        timeZone: null,
        locale: null,
        theme: null,
      } as never)
    prismaMock.groupMember.findMany.mockResolvedValue([
      {
        role: 'ADMIN',
        group: {
          createdAt: new Date('2026-01-01'),
          ledger: { currencyCode: null },
        },
      },
    ] as never)

    await makeCaller('acct-1').initializePreferences({})

    expect(prismaMock.accountPreference.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { defaultCurrencyCode: 'USD' },
      }),
    )
  })

  it('does not inspect groups or replace an existing account currency', async () => {
    prismaMock.accountPreference.findUnique.mockResolvedValue({
      defaultCurrencyCode: 'AED',
      timeZone: 'UTC',
      locale: 'en-US',
      theme: 'system',
    } as never)

    const result = await makeCaller('acct-1').initializePreferences({})

    expect(prismaMock.groupMember.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          group: { archived: false },
        }),
      }),
    )
    expect(prismaMock.accountPreference.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          defaultCurrencyCode: expect.anything(),
        }),
      }),
    )
    expect(result.preferences.defaultCurrencyCode).toBe('AED')
  })

  it('patches only supplied fields', async () => {
    prismaMock.accountPreference.upsert.mockResolvedValue({
      defaultCurrencyCode: 'EUR',
      timeZone: 'Europe/Paris',
      locale: 'fr-FR',
      theme: 'system',
    } as never)

    const result = await makeCaller('acct-1').updatePreferences({
      defaultCurrencyCode: 'EUR',
    })

    expect(prismaMock.accountPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'acct-1' },
        create: expect.objectContaining({
          accountId: 'acct-1',
          defaultCurrencyCode: 'EUR',
        }),
        update: {
          defaultCurrencyCode: 'EUR',
        },
      }),
    )
    expect(result.preferences.defaultCurrencyCode).toBe('EUR')
  })

  it('patches AI feature preferences independently of other prefs', async () => {
    prismaMock.accountPreference.upsert.mockResolvedValue({
      defaultCurrencyCode: 'EUR',
      timeZone: 'Europe/Skopje',
      locale: 'en-US',
      theme: 'system',
      // Explicit false on receipt scan reflects what the user just wrote;
      // the two untouched AI fields come back nullish so the response
      // exercises the null → default-on normalization path.
      aiFeaturesEnabled: null,
      aiCategoryExtractEnabled: null,
      aiReceiptScanEnabled: false,
      aiVoiceExpenseEnabled: null,
    } as never)

    const result = await makeCaller('acct-1').updatePreferences({
      aiReceiptScanEnabled: false,
    })

    expect(prismaMock.accountPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'acct-1' },
        update: { aiReceiptScanEnabled: false },
      }),
    )
    // Server-side normalization: explicit false stays false; nullish fields
    // become the default-on boolean before the response leaves the API.
    expect(result.preferences.aiFeaturesEnabled).toBe(true)
    expect(result.preferences.aiReceiptScanEnabled).toBe(false)
    expect(result.preferences.aiVoiceExpenseEnabled).toBe(true)
    expect(result.preferences.aiCategoryExtractEnabled).toBe(true)
  })

  it('persists a supported mascot independently', async () => {
    prismaMock.accountPreference.upsert.mockResolvedValue({
      defaultCurrencyCode: 'EUR',
      timeZone: 'Europe/Skopje',
      locale: 'en-US',
      theme: 'system',
      mascot: 'bill',
    } as never)

    const result = await makeCaller('acct-1').updatePreferences({
      mascot: 'bill',
    })

    expect(prismaMock.accountPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { mascot: 'bill' },
      }),
    )
    expect(result.preferences.mascot).toBe('bill')
  })

  it('patches the master AI preference without changing child preferences', async () => {
    prismaMock.accountPreference.upsert.mockResolvedValue({
      defaultCurrencyCode: 'EUR',
      timeZone: 'Europe/Skopje',
      locale: 'en-US',
      theme: 'system',
      aiFeaturesEnabled: false,
      aiCategoryExtractEnabled: false,
      aiReceiptScanEnabled: true,
      aiVoiceExpenseEnabled: null,
    } as never)

    const result = await makeCaller('acct-1').updatePreferences({
      aiFeaturesEnabled: false,
    })

    expect(prismaMock.accountPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'acct-1' },
        create: expect.objectContaining({
          accountId: 'acct-1',
          aiFeaturesEnabled: false,
        }),
        update: { aiFeaturesEnabled: false },
      }),
    )
    expect(result.preferences.aiFeaturesEnabled).toBe(false)
    expect(result.preferences.aiCategoryExtractEnabled).toBe(false)
    expect(result.preferences.aiReceiptScanEnabled).toBe(true)
    expect(result.preferences.aiVoiceExpenseEnabled).toBe(true)
  })

  it.each([
    [{ defaultCurrencyCode: 'ZZZ' }, 'unsupported default currency'],
    [{ timeZone: 'Mars/Olympus' }, 'invalid timezone'],
    [{ locale: 'xx-XX' }, 'unsupported locale'],
    [{ theme: 'sepia' }, 'unsupported theme'],
    [{ mascot: 'ghost' }, 'unsupported mascot'],
  ])('rejects %s (%s)', async (input) => {
    await expect(
      makeCaller('acct-1').updatePreferences(input as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prismaMock.accountPreference.upsert).not.toHaveBeenCalled()
  })
})

describe('accountRouter.setPreference — hide API', () => {
  it('writes `hidden` directly to the `hidden` column', async () => {
    await authAs('acct-1')
    prismaMock.accountGroupPreference.upsert.mockResolvedValue({
      id: 'pref-1',
      groupId: 'grp-1',
      accountId: 'acct-1',
      starred: false,
      hidden: true,
    } as never)

    const caller = makeCaller('acct-1')
    const result = await caller.setPreference({
      groupId: 'grp-1',
      hidden: true,
    })

    expect(result.preferences).toMatchObject({ hidden: true })
    expect(prismaMock.accountGroupPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ hidden: true }),
        update: { hidden: true },
      }),
    )
  })

  it('returns the preference shape with `hidden` only', async () => {
    await authAs('acct-1')
    prismaMock.accountGroupPreference.upsert.mockResolvedValue({
      id: 'pref-1',
      starred: true,
      hidden: true,
    } as never)

    const caller = makeCaller('acct-1')
    const result = await caller.setPreference({
      groupId: 'grp-1',
      starred: true,
      hidden: true,
    })

    expect(result.preferences).toEqual({
      starred: true,
      hidden: true,
    })
  })
})

describe('accountRouter.preferences — hide API', () => {
  it('returns the row mapped to `hidden`', async () => {
    await authAs('acct-1')
    prismaMock.accountGroupPreference.findUnique.mockResolvedValue({
      id: 'pref-1',
      accountId: 'acct-1',
      groupId: 'grp-1',
      starred: true,
      hidden: true,
    } as never)

    const caller = makeCaller('acct-1')
    const result = await caller.preferences({ groupId: 'grp-1' })

    expect(result.preferences).toEqual({
      starred: true,
      hidden: true,
    })
  })

  it('returns the default preference when no row exists', async () => {
    await authAs('acct-1')
    prismaMock.accountGroupPreference.findUnique.mockResolvedValue(null)

    const caller = makeCaller('acct-1')
    const result = await caller.preferences({ groupId: 'grp-1' })

    expect(result.preferences).toEqual({
      starred: false,
      hidden: false,
    })
  })
})

describe('accountRouter profile cache invalidation', () => {
  it('invalidates the cached account after a profile update', async () => {
    clearAccountCache()
    const initialAccount = {
      id: 'acct-profile',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
      image: null,
    }
    const updatedAccount = { ...initialAccount, name: 'Alice Updated' }
    prismaMock.user.findUnique.mockResolvedValueOnce(initialAccount as never)
    prismaMock.user.update.mockResolvedValue(updatedAccount as never)

    await getCachedAccount('acct-profile')
    await makeCaller('acct-profile').updateProfile({ name: 'Alice Updated' })
    prismaMock.user.findUnique.mockResolvedValueOnce(updatedAccount as never)

    await expect(getCachedAccount('acct-profile')).resolves.toEqual({
      ...updatedAccount,
      anonymousOnboardingCompleted: true,
    })
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2)
  })
})

describe('accountRouter.groups — archive + hide filters', () => {
  it('excludes group-archived and user-hidden groups by default', async () => {
    await authAs('acct-1')
    mockGroupWithMembership('acct-1', [
      { id: 'g-active', archived: false, role: 'ADMIN', members: 2 },
      { id: 'g-archived', archived: true, role: 'ADMIN', members: 3 },
      {
        id: 'g-hidden',
        archived: false,
        role: 'ADMIN',
        members: 2,
        preferences: { hidden: true },
      },
    ])

    const caller = makeCaller('acct-1')
    const result = await caller.groups({ includeArchived: false })

    expect(result.groups.map((g) => g.id)).toEqual(['g-active'])
  })

  it('includes group-archived and user-hidden groups when includeArchived is true', async () => {
    await authAs('acct-1')
    mockGroupWithMembership('acct-1', [
      { id: 'g-active', archived: false, role: 'ADMIN', members: 2 },
      { id: 'g-archived', archived: true, role: 'ADMIN', members: 3 },
      {
        id: 'g-hidden',
        archived: false,
        role: 'ADMIN',
        members: 2,
        preferences: { hidden: true },
      },
    ])

    const caller = makeCaller('acct-1')
    const result = await caller.groups({ includeArchived: true })

    expect(result.groups.map((g) => g.id).sort()).toEqual([
      'g-active',
      'g-archived',
      'g-hidden',
    ])
    const hidden = result.groups.find((g) => g.id === 'g-hidden')!
    expect(hidden.preference).toMatchObject({ hidden: true })
  })

  it('includes the caller role for each group in the response', async () => {
    await authAs('acct-1')
    mockGroupWithMembership('acct-1', [
      { id: 'g-1', archived: false, role: 'ADMIN', members: 2 },
      { id: 'g-2', archived: false, role: 'MEMBER', members: 3 },
    ])

    const caller = makeCaller('acct-1')
    const result = await caller.groups({ includeArchived: false })

    expect(result.groups.find((g) => g.id === 'g-1')?.currentMemberRole).toBe(
      'ADMIN',
    )
    expect(result.groups.find((g) => g.id === 'g-2')?.currentMemberRole).toBe(
      'MEMBER',
    )
  })

  it('attaches the latest expense timestamp with one ledger aggregation', async () => {
    await authAs('acct-1')
    mockGroupWithMembership('acct-1', [
      { id: 'g-1', archived: false, role: 'ADMIN', members: 2 },
      { id: 'g-2', archived: false, role: 'MEMBER', members: 3 },
    ])
    prismaMock.expense.groupBy.mockResolvedValue([
      {
        ledgerId: 'ledger-g-1',
        _max: { createdAt: new Date('2026-07-20T12:00:00.000Z') },
      },
    ] as never)

    const result = await makeCaller('acct-1').groups({
      includeArchived: false,
    })

    expect(prismaMock.expense.groupBy).toHaveBeenCalledWith({
      by: ['ledgerId'],
      where: { ledgerId: { in: ['ledger-g-1', 'ledger-g-2'] } },
      _max: { createdAt: true },
    })
    expect(result.groups.find((group) => group.id === 'g-1')).toMatchObject({
      latestExpenseCreatedAt: '2026-07-20T12:00:00.000Z',
    })
    expect(result.groups.find((group) => group.id === 'g-2')).toMatchObject({
      latestExpenseCreatedAt: null,
    })
  })
})

describe('accountRouter.deletePasskey', () => {
  const accountId = 'acct-passkey'
  const passkeyRow = { id: 'pk-1', userId: accountId }

  function mockPasskeyState({
    passkey = passkeyRow,
    // Post-delete remaining count: the mutation deletes first, then
    // verifies inside one transaction. 0 = this was the last passkey.
    passkeyCount = 0,
    user = {
      id: accountId,
      email: `${accountId}@placeholder.local`,
      emailVerified: false,
    },
    identities = [],
    recovery = null,
  }: {
    passkey?: { id: string; userId: string } | null
    passkeyCount?: number
    user?: { id: string; email: string; emailVerified: boolean } | null
    identities?: Array<{ providerId: string; password: string | null }>
    recovery?: {
      acknowledgedAt: Date | null
      onboardingCompletedAt: Date | null
    } | null
  } = {}) {
    prismaMock.passkey.findUnique.mockResolvedValue(passkey as never)
    prismaMock.passkey.count.mockResolvedValue(passkeyCount as never)
    prismaMock.user.findUnique.mockResolvedValue(user as never)
    prismaMock.account.findMany.mockResolvedValue(identities as never)
    prismaMock.anonymousRecoveryCredential.findUnique.mockResolvedValue(
      recovery as never,
    )
    prismaMock.passkey.delete.mockResolvedValue(passkeyRow as never)
  }

  it('requires authentication', async () => {
    await expect(
      makeAnonymousCaller().deletePasskey({ id: 'pk-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('returns NOT_FOUND for an unknown passkey', async () => {
    mockPasskeyState({ passkey: null })
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prismaMock.passkey.delete).not.toHaveBeenCalled()
  })

  it('returns NOT_FOUND for another account’s passkey', async () => {
    mockPasskeyState({ passkey: { id: 'pk-other', userId: 'acct-other' } })
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-other' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prismaMock.passkey.delete).not.toHaveBeenCalled()
  })

  it('blocks removing the only sign-in method of a bare anonymous account', async () => {
    mockPasskeyState()
    // Delete-then-verify: the delete is attempted inside the transaction
    // and rolled back by the guard, so only the CONFLICT is observable.
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('blocks a placeholder-email account with no password or provider', async () => {
    mockPasskeyState({
      user: {
        id: accountId,
        email: 'x123@link.placeholder.local',
        emailVerified: false,
      },
    })
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('blocks when the verified email cannot receive a magic link', async () => {
    mockPasskeyState({
      user: {
        id: accountId,
        email: 'alice@example.com',
        emailVerified: true,
      },
    })
    const previous = env.ENABLE_EMAIL_AUTH
    env.ENABLE_EMAIL_AUTH = false
    try {
      await expect(
        makeCaller(accountId).deletePasskey({ id: 'pk-1' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' })
    } finally {
      env.ENABLE_EMAIL_AUTH = previous
    }
  })

  it('allows removal when an acknowledged recovery link exists', async () => {
    const acknowledgedAt = new Date('2026-01-01T00:00:00Z')
    mockPasskeyState({
      recovery: {
        acknowledgedAt,
        onboardingCompletedAt: acknowledgedAt,
      },
    })
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-1' }),
    ).resolves.toEqual({ success: true })
    expect(prismaMock.passkey.delete).toHaveBeenCalledWith({
      where: { id: 'pk-1' },
    })
    // The recovery link is never touched by passkey removal: it stays until
    // an explicit rotation/removal.
    expect(prismaMock.anonymousRecoveryCredential.delete).not.toHaveBeenCalled()
  })

  it('allows removal with a verified real email while email auth is on', async () => {
    mockPasskeyState({
      user: {
        id: accountId,
        email: 'alice@example.com',
        emailVerified: true,
      },
    })
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-1' }),
    ).resolves.toEqual({ success: true })
    expect(prismaMock.passkey.delete).toHaveBeenCalled()
  })

  it('allows removal when a password is set', async () => {
    mockPasskeyState({
      identities: [{ providerId: 'credential', password: 'hashed' }],
    })
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-1' }),
    ).resolves.toEqual({ success: true })
    expect(prismaMock.passkey.delete).toHaveBeenCalled()
  })

  it('allows removal when an OAuth provider is linked', async () => {
    mockPasskeyState({
      identities: [{ providerId: 'google', password: null }],
    })
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-1' }),
    ).resolves.toEqual({ success: true })
    expect(prismaMock.passkey.delete).toHaveBeenCalled()
  })

  it('allows removal while a second passkey remains', async () => {
    mockPasskeyState({ passkeyCount: 1 })
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-1' }),
    ).resolves.toEqual({ success: true })
    expect(prismaMock.passkey.delete).toHaveBeenCalled()
  })

  it('allows removal during incomplete onboarding when another method exists', async () => {
    // Gate-exempt: a fresh anonymous account registers its first passkey
    // before onboarding completes, and the CONFLICT check above is the real
    // lockout guard — the onboarding gate must not decide this.
    const acknowledgedAt = new Date('2026-01-01T00:00:00Z')
    mockPasskeyState({
      recovery: {
        acknowledgedAt,
        onboardingCompletedAt: acknowledgedAt,
      },
    })
    await expect(
      makeCaller(accountId, { isAnonymous: true }).deletePasskey({
        id: 'pk-1',
      }),
    ).resolves.toEqual({ success: true })
  })

  it('locks the account row so concurrent deletions serialize', async () => {
    const acknowledgedAt = new Date('2026-01-01T00:00:00Z')
    mockPasskeyState({
      recovery: {
        acknowledgedAt,
        onboardingCompletedAt: acknowledgedAt,
      },
    })
    await makeCaller(accountId).deletePasskey({ id: 'pk-1' })
    expect(prisma$QueryRaw).toHaveBeenCalledTimes(1)
    const [strings] = prisma$QueryRaw.mock.calls[0] as unknown as [
      TemplateStringsArray,
    ]
    expect(strings.join('')).toContain('FOR UPDATE')
  })

  it('returns NOT_FOUND when the passkey vanishes mid-transaction', async () => {
    mockPasskeyState()
    prismaMock.passkey.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        'Record to delete does not exist.',
        { code: 'P2025', clientVersion: 'test' },
      ),
    )
    await expect(
      makeCaller(accountId).deletePasskey({ id: 'pk-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('invalidates the cached account after removal', async () => {
    clearAccountCache()
    const account = {
      id: accountId,
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
      image: null,
    }
    mockPasskeyState({
      passkeyCount: 1,
      user: {
        id: accountId,
        email: 'alice@example.com',
        emailVerified: true,
      },
    })
    prismaMock.user.findUnique.mockResolvedValueOnce(account as never)

    await getCachedAccount(accountId)
    await makeCaller(accountId).deletePasskey({ id: 'pk-1' })
    prismaMock.user.findUnique.mockResolvedValueOnce(account as never)
    await getCachedAccount(accountId)

    // One read per cache miss: the guard is skipped (a passkey remains),
    // so only the two getCachedAccount misses hit the database.
    // Two reads — not one — proves the mutation invalidated the cache.
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2)
  })
})

describe('accountRouter.afterPasskeyChange', () => {
  it('requires authentication', async () => {
    await expect(
      makeAnonymousCaller().afterPasskeyChange(),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('succeeds while anonymous onboarding is still incomplete', async () => {
    // Gate-exempt: this ping is what flips the gate for fresh anonymous
    // accounts, so gating it on the still-stale cached row would deadlock
    // completing onboarding right after registering a passkey.
    await expect(
      makeCaller('acct-fresh', { isAnonymous: true }).afterPasskeyChange(),
    ).resolves.toEqual({ success: true })
  })

  it('invalidates the cached account', async () => {
    clearAccountCache()
    const account = {
      id: 'acct-ping',
      email: 'ping@example.com',
      emailVerified: true,
      name: 'Ping',
      image: null,
    }
    prismaMock.user.findUnique.mockResolvedValueOnce(account as never)

    await getCachedAccount('acct-ping')
    await expect(makeCaller('acct-ping').afterPasskeyChange()).resolves.toEqual(
      { success: true },
    )
    prismaMock.user.findUnique.mockResolvedValueOnce(account as never)
    await getCachedAccount('acct-ping')

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2)
  })
})
