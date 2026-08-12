import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import {
  clearAccountCache,
  getCachedAccount,
} from '../../../lib/auth/account-cache'
import { authState, prismaMock } from '../../../test/state'
import { createTRPCContext } from '../../init'
import { accountRouter } from './index'

function makeCaller(authUserId: string) {
  return accountRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
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
  prismaMock.account.findUnique.mockImplementation(async (args: unknown) => {
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
        mascot: 'off',
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
    prismaMock.account.findUnique.mockResolvedValueOnce(initialAccount as never)
    prismaMock.account.update.mockResolvedValue(updatedAccount as never)

    await getCachedAccount('acct-profile')
    await makeCaller('acct-profile').updateProfile({ name: 'Alice Updated' })
    prismaMock.account.findUnique.mockResolvedValueOnce(updatedAccount as never)

    await expect(getCachedAccount('acct-profile')).resolves.toEqual(
      updatedAccount,
    )
    expect(prismaMock.account.findUnique).toHaveBeenCalledTimes(2)
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
