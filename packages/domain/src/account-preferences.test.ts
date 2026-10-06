import {
  accountLocaleSchema,
  accountMascotSchema,
  accountPreferenceSchema,
  accountThemeSchema,
  defaultGroupTabOrder,
  destructiveConfirmationLevelSchema,
  groupTabIdSchema,
  hideableGroupTabIdSchema,
  requiresTypedConfirmation,
  resolveDestructiveConfirmationLevel,
  resolveGroupTabOrder,
  supportedCurrencyCodeSchema,
} from './account-preferences'

describe('account preference schemas', () => {
  it('accepts supported themes, locales, and ISO currencies', () => {
    expect(accountThemeSchema.parse('system')).toBe('system')
    expect(accountMascotSchema.parse('bill')).toBe('bill')
    expect(accountLocaleSchema.parse('mk-MK')).toBe('mk-MK')
    expect(supportedCurrencyCodeSchema.parse('EUR')).toBe('EUR')
  })

  it('rejects unknown themes, locales, and custom currencies', () => {
    expect(accountThemeSchema.safeParse('sepia').success).toBe(false)
    expect(accountMascotSchema.safeParse('ghost').success).toBe(false)
    expect(accountLocaleSchema.safeParse('xx-XX').success).toBe(false)
    expect(supportedCurrencyCodeSchema.safeParse('CUSTOM').success).toBe(false)
  })

  it('allows unset scalar preferences', () => {
    expect(
      accountPreferenceSchema.parse({
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
      }),
    ).toEqual({
      defaultCurrencyCode: null,
      timeZone: null,
      locale: null,
      theme: null,
    })
  })

  it('accepts known destructive confirmation levels and rejects unknown ones', () => {
    expect(destructiveConfirmationLevelSchema.parse('strict')).toBe('strict')
    expect(destructiveConfirmationLevelSchema.parse('standard')).toBe(
      'standard',
    )
    expect(
      destructiveConfirmationLevelSchema.safeParse('relaxed').success,
    ).toBe(false)
  })

  it('accepts a missing destructive confirmation level for older shapes', () => {
    expect(
      accountPreferenceSchema.parse({
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
      }).destructiveConfirmationLevel,
    ).toBeUndefined()
    expect(
      accountPreferenceSchema.parse({
        defaultCurrencyCode: null,
        timeZone: null,
        locale: null,
        theme: null,
        destructiveConfirmationLevel: null,
      }).destructiveConfirmationLevel,
    ).toBeNull()
  })
})

describe('destructive confirmation level', () => {
  it('normalizes missing values to the historical strict behaviour', () => {
    expect(resolveDestructiveConfirmationLevel(undefined)).toBe('strict')
    expect(resolveDestructiveConfirmationLevel(null)).toBe('strict')
    expect(resolveDestructiveConfirmationLevel('strict')).toBe('strict')
    expect(resolveDestructiveConfirmationLevel('standard')).toBe('standard')
    expect(resolveDestructiveConfirmationLevel('relaxed')).toBe('strict')
  })

  it('always requires typing for group and participant deletes', () => {
    for (const level of ['standard', 'strict'] as const) {
      expect(requiresTypedConfirmation(level, 'deleteGroup')).toBe(true)
      expect(requiresTypedConfirmation(level, 'removeParticipant')).toBe(true)
    }
  })

  it('requires typing for expense deletes only in strict mode', () => {
    expect(requiresTypedConfirmation('strict', 'deleteExpense')).toBe(true)
    expect(requiresTypedConfirmation('strict', 'deleteRecurringExpense')).toBe(
      true,
    )
    expect(requiresTypedConfirmation('standard', 'deleteExpense')).toBe(false)
    expect(
      requiresTypedConfirmation('standard', 'deleteRecurringExpense'),
    ).toBe(false)
  })

  it('treats a missing level as strict for expense deletes', () => {
    expect(requiresTypedConfirmation(null, 'deleteExpense')).toBe(true)
    expect(requiresTypedConfirmation(undefined, 'deleteExpense')).toBe(true)
  })
})

describe('group tab order', () => {
  it('uses expenses, balances, activity, members as the default order', () => {
    expect([...defaultGroupTabOrder]).toEqual([
      'expenses',
      'balances',
      'activity',
      'members',
      'stats',
      'budgets',
      'tools',
      'edit',
    ])
  })

  it('accepts known tab ids and rejects unknown ones', () => {
    expect(groupTabIdSchema.parse('activity')).toBe('activity')
    expect(groupTabIdSchema.safeParse('overview').success).toBe(false)
    expect(hideableGroupTabIdSchema.parse('stats')).toBe('stats')
    expect(hideableGroupTabIdSchema.safeParse('expenses').success).toBe(false)
    expect(hideableGroupTabIdSchema.safeParse('edit').success).toBe(false)
  })

  it('resolves a missing or empty order to the default', () => {
    expect(resolveGroupTabOrder(null)).toEqual([...defaultGroupTabOrder])
    expect(resolveGroupTabOrder(undefined)).toEqual([...defaultGroupTabOrder])
    expect(resolveGroupTabOrder([])).toEqual([...defaultGroupTabOrder])
  })

  it('keeps a custom order and appends missing tabs in default order', () => {
    expect(resolveGroupTabOrder(['members', 'expenses'])).toEqual([
      'members',
      'expenses',
      'balances',
      'activity',
      'stats',
      'budgets',
      'tools',
      'edit',
    ])
  })

  it('drops unknown ids and duplicate entries', () => {
    expect(
      resolveGroupTabOrder(['tools', 'overview', 'tools', 'expenses']),
    ).toEqual([
      'tools',
      'expenses',
      'balances',
      'activity',
      'members',
      'stats',
      'budgets',
      'edit',
    ])
  })
})
