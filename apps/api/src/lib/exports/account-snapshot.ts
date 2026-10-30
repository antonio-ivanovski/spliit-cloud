import { GroupMemberStatus, type Prisma, prisma } from '@spliit/db'
import {
  accountPreferenceSchema,
  accountExportSelectionSchema,
  notificationCategorySchema,
  notificationChannelsSchema,
  resolveAccountExportGroupIds,
  type AccountPreference,
  type AccountExportSelection,
} from '@spliit/domain'

import {
  loadGroupExportSources,
  type GroupExportSource,
} from './group-snapshot'

const accountPreferenceSelect = {
  defaultCurrencyCode: true,
  timeZone: true,
  locale: true,
  theme: true,
  mascot: true,
  notificationsEnabled: true,
  aiFeaturesEnabled: true,
  aiCategoryExtractEnabled: true,
  aiReceiptScanEnabled: true,
  aiVoiceExpenseEnabled: true,
  groupTabOrder: true,
  hiddenGroupTabs: true,
  destructiveConfirmationLevel: true,
} as const

export class InvalidAccountExportSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAccountExportSelectionError'
  }
}

type AccountExportGroupPreference = {
  starred: boolean
  hidden: boolean
  personalSplitPresets: Array<{
    id: string
    name: string
    target: 'PAID_BY' | 'PAID_FOR'
    splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE'
    createdAt: Date
    updatedAt: Date
    participants: Array<{ participantId: string; shares: number }>
  }>
  personalDefaults: {
    paidByDefaultMode: 'INHERIT' | 'PRESET' | 'NEUTRAL'
    paidByDefaultPresetId: string | null
    paidForDefaultMode: 'INHERIT' | 'PRESET' | 'NEUTRAL'
    paidForDefaultPresetId: string | null
  }
}

export type AccountExportGroupSource = {
  source: GroupExportSource
  preference: AccountExportGroupPreference
}

export type AccountExportSource = {
  account: {
    id: string
    name: string
    email: string
    preference: AccountPreference | null
  }
  notificationPreferences: Array<{
    category: ReturnType<typeof notificationCategorySchema.parse>
    channels: ReturnType<typeof notificationChannelsSchema.parse>
  }>
  groups: AccountExportGroupSource[]
  personal: PersonalExportSource | null
}

export type PersonalExportSource = {
  profile: {
    currencyCode: string
    timeZone: string
    sharedEnabled: boolean
    createdAt: Date
    updatedAt: Date
  } | null
  transactions: Array<{
    id: string
    kind: 'EXPENSE' | 'INCOME'
    amount: number
    currencyCode: string
    originalAmount: number | null
    originalCurrency: string | null
    conversionRate: number | null
    conversionSource: 'EXCHANGE' | 'CUSTOM' | 'EXACT' | null
    date: Date
    categoryId: string
    title: string | null
    note: string | null
    version: number
    source: 'PERSONAL' | 'GROUP'
    sourceExpenseId: string | null
    sourceGroupId: string | null
    sourceGroupName: string | null
    sourceDetachedAt: Date | null
    personalRecurringSeriesId: string | null
    recurrenceSequence: number | null
    createdAt: Date
    updatedAt: Date
  }>
  budgets: Array<{
    id: string
    name: string
    amount: number
    currencyCode: string
    period: 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM'
    timeZone: string
    categoryScope: 'ALL' | 'SELECTED'
    categoryIds: string[]
    startDay: number
    archived: boolean
    archivedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }>
  rules: Array<{
    id: string
    groupId: string
    included: boolean
    includeFrom: Date | null
    createdAt: Date
    updatedAt: Date
  }>
  overrides: Array<{
    id: string
    expenseId: string
    state: 'INCLUDE' | 'EXCLUDE' | null
    categoryId: string | null
    createdAt: Date
    updatedAt: Date
  }>
  importSources: Array<{
    personalTransactionId: string
    provider: string
    importKey: string
    externalIdentityHash: string | null
    semanticHash: string
    rawHash: string
    importedByAccountId: string | null
    createdAt: Date
  }>
  recurringSeries: Array<{
    id: string
    timeZone: string
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
    interval: number
    anchorDate: Date
    anchorSequence: number
    nextOccurrenceDate: Date
    nextOccurrenceOrdinal: number
    endType: 'INDEFINITE' | 'COUNT' | 'DATE'
    occurrenceLimit: number | null
    endDate: Date | null
    occurrencesCreated: number
    status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
    kind: 'EXPENSE' | 'INCOME'
    amount: number
    currencyCode: string
    categoryId: string
    title: string | null
    note: string | null
    version: number
    createdAt: Date
    updatedAt: Date
  }>
  attachments: Array<{
    id: string
    personalTransactionId: string
    url: string
    fileName: string | null
    contentType: string | null
    width: number | null
    height: number | null
  }>
}

type AccountExportMembership = {
  groupId: string
  group: {
    id: string
    groupType: 'GROUP' | 'FRIEND'
    archived: boolean
  }
}

/**
 * Capture all account-export data in one repeatable-read transaction. S3
 * document bytes are intentionally not read here; the resulting immutable
 * source is handed to the streaming archive assembler afterwards.
 */
export async function loadAccountExportSource(
  accountId: string,
  input: AccountExportSelection,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AccountExportSource> {
  const selection = accountExportSelectionSchema.parse(input)
  const account = await client.user.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
      email: true,
      preference: { select: accountPreferenceSelect },
      notificationPreferences: {
        select: { category: true, channels: true },
        orderBy: { category: 'asc' },
      },
    },
  })
  if (!account) {
    throw new InvalidAccountExportSelectionError('Account was not found.')
  }

  const memberships = (await client.groupMember.findMany({
    where: { accountId, status: GroupMemberStatus.ACTIVE },
    select: {
      groupId: true,
      group: { select: { id: true, groupType: true, archived: true } },
    },
    orderBy: { groupId: 'asc' },
  })) as AccountExportMembership[]
  const groupIds = memberships.map((membership) => membership.groupId)

  const preferenceRows =
    (await client.accountGroupPreference.findMany({
      where: { accountId, groupId: { in: groupIds } },
      select: {
        groupId: true,
        starred: true,
        hidden: true,
        paidByDefaultMode: true,
        paidByDefaultPresetId: true,
        paidForDefaultMode: true,
        paidForDefaultPresetId: true,
      },
    })) ?? []

  const personalPresetRows = client.splitPreset?.findMany
    ? ((await client.splitPreset.findMany({
        where: { ownerAccountId: accountId, groupId: { in: groupIds } },
        orderBy: [
          { groupId: 'asc' },
          { nameKey: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        include: { participants: { orderBy: { participantId: 'asc' } } },
      })) ?? [])
    : []
  const personalPresetsByGroupId = new Map<string, typeof personalPresetRows>()
  for (const preset of personalPresetRows) {
    const current = personalPresetsByGroupId.get(preset.groupId) ?? []
    current.push(preset)
    personalPresetsByGroupId.set(preset.groupId, current)
  }

  const preferenceByGroupId = new Map(
    preferenceRows.map((preference) => [preference.groupId, preference]),
  )
  const activeGroupIds = new Set(groupIds)
  for (const override of selection.groupOverrides) {
    if (!activeGroupIds.has(override.groupSourceId)) {
      throw new InvalidAccountExportSelectionError(
        'The export selection contains a group that is no longer available.',
      )
    }
  }

  const selectedGroupIds = resolveAccountExportGroupIds(
    memberships.map((membership) => {
      const preference = preferenceByGroupId.get(membership.groupId)
      return {
        id: membership.groupId,
        groupType: membership.group.groupType,
        archived: membership.group.archived,
        starred: preference?.starred ?? false,
        hidden: preference?.hidden ?? false,
      }
    }),
    selection,
  )

  if (
    selectedGroupIds.length === 0 &&
    !selection.includeAccountPreferences &&
    !selection.includePersonal
  ) {
    throw new InvalidAccountExportSelectionError(
      'Select at least one group or include some other content (account preferences or personal data).',
    )
  }

  const loadedGroups = await loadGroupExportSources(selectedGroupIds, client)
  const sourceByGroupId = new Map(
    loadedGroups.map((source) => [source.id, source]),
  )
  const groups: AccountExportGroupSource[] = []
  for (const groupId of selectedGroupIds) {
    const source = sourceByGroupId.get(groupId)
    if (!source) {
      throw new InvalidAccountExportSelectionError(
        'A selected group is no longer available.',
      )
    }
    const preference = preferenceByGroupId.get(groupId)
    groups.push({
      source,
      preference: {
        starred: preference?.starred ?? false,
        hidden: preference?.hidden ?? false,
        personalSplitPresets: (personalPresetsByGroupId.get(groupId) ?? []).map(
          (preset) => ({
            id: preset.id,
            name: preset.name,
            target: preset.target as 'PAID_BY' | 'PAID_FOR',
            splitMode: preset.splitMode as
              | 'EVENLY'
              | 'BY_SHARES'
              | 'BY_PERCENTAGE',
            createdAt: preset.createdAt,
            updatedAt: preset.updatedAt,
            participants: preset.participants.map(
              ({ participantId, shares }) => ({
                participantId,
                shares,
              }),
            ),
          }),
        ),
        personalDefaults: {
          paidByDefaultMode: preference?.paidByDefaultMode ?? 'INHERIT',
          paidByDefaultPresetId: preference?.paidByDefaultPresetId ?? null,
          paidForDefaultMode: preference?.paidForDefaultMode ?? 'INHERIT',
          paidForDefaultPresetId: preference?.paidForDefaultPresetId ?? null,
        },
      },
    })
  }

  return {
    account: {
      id: account.id,
      name: account.name,
      email: account.email,
      preference: account.preference
        ? accountPreferenceSchema.parse(account.preference)
        : null,
    },
    notificationPreferences: account.notificationPreferences.map((row) => ({
      category: notificationCategorySchema.parse(row.category),
      channels: notificationChannelsSchema.parse(row.channels),
    })),
    groups,
    personal: selection.includePersonal
      ? await loadPersonalExportSource(accountId, client)
      : null,
  }
}

async function loadPersonalExportSource(
  accountId: string,
  client: Prisma.TransactionClient | typeof prisma,
): Promise<PersonalExportSource> {
  const [
    profile,
    transactions,
    budgets,
    rules,
    overrides,
    importSources,
    recurringSeries,
    attachments,
  ] = await Promise.all([
    client.personalProfile.findUnique({ where: { accountId } }),
    client.personalTransaction.findMany({
      where: { accountId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    client.personalBudget.findMany({
      where: { accountId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    client.personalGroupRule.findMany({
      where: { accountId },
      orderBy: { groupId: 'asc' },
    }),
    client.personalExpenseOverride.findMany({
      where: { accountId },
      orderBy: { expenseId: 'asc' },
    }),
    // Explicit allow-list: `meta` is unbounded JSON and stays out of bundles.
    client.personalFileImportSource.findMany({
      where: { accountId },
      select: {
        personalTransactionId: true,
        provider: true,
        importKey: true,
        externalIdentityHash: true,
        semanticHash: true,
        rawHash: true,
        importedByAccountId: true,
        createdAt: true,
      },
      orderBy: { personalTransactionId: 'asc' },
    }),
    client.personalRecurringSeries.findMany({
      where: { accountId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    client.personalAttachment.findMany({
      where: { accountId },
      orderBy: { id: 'asc' },
    }),
  ])

  return {
    profile: profile
      ? {
          currencyCode: profile.currencyCode,
          timeZone: profile.timeZone,
          sharedEnabled: profile.sharedEnabled,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        }
      : null,
    transactions: transactions.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      currencyCode: row.currencyCode,
      originalAmount: row.originalAmount,
      originalCurrency: row.originalCurrency,
      conversionRate: row.conversionRate,
      conversionSource: row.conversionSource,
      date: row.date,
      categoryId: row.categoryId,
      title: row.title,
      note: row.note,
      version: row.version,
      source: row.source,
      sourceExpenseId: row.sourceExpenseId,
      sourceGroupId: row.sourceGroupId,
      sourceGroupName: row.sourceGroupName,
      sourceDetachedAt: row.sourceDetachedAt,
      personalRecurringSeriesId: row.personalRecurringSeriesId,
      recurrenceSequence: row.recurrenceSequence,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    budgets: budgets.map((row) => ({
      id: row.id,
      name: row.name,
      amount: row.amount,
      currencyCode: row.currencyCode,
      period: row.period,
      timeZone: row.timeZone,
      categoryScope: row.categoryScope,
      categoryIds: [...row.categoryIds].sort(),
      startDay: row.startDay,
      archived: row.archived,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    rules: rules.map((row) => ({
      id: row.id,
      groupId: row.groupId,
      included: row.included,
      includeFrom: row.includeFrom,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    overrides: overrides.map((row) => ({
      id: row.id,
      expenseId: row.expenseId,
      state: row.state,
      categoryId: row.categoryId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    importSources: importSources.map((row) => ({
      personalTransactionId: row.personalTransactionId,
      provider: row.provider,
      importKey: row.importKey,
      externalIdentityHash: row.externalIdentityHash,
      semanticHash: row.semanticHash,
      rawHash: row.rawHash,
      importedByAccountId: row.importedByAccountId,
      createdAt: row.createdAt,
    })),
    recurringSeries: recurringSeries.map((row) => ({
      id: row.id,
      timeZone: row.timeZone,
      frequency: row.frequency,
      interval: row.interval,
      anchorDate: row.anchorDate,
      anchorSequence: row.anchorSequence,
      nextOccurrenceDate: row.nextOccurrenceDate,
      nextOccurrenceOrdinal: row.nextOccurrenceOrdinal,
      endType: row.endType,
      occurrenceLimit: row.occurrenceLimit,
      endDate: row.endDate,
      occurrencesCreated: row.occurrencesCreated,
      status: row.status,
      kind: row.kind,
      amount: row.amount,
      currencyCode: row.currencyCode,
      categoryId: row.categoryId,
      title: row.title,
      note: row.note,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    attachments: attachments.map((row) => ({
      id: row.id,
      personalTransactionId: row.personalTransactionId,
      url: row.url,
      fileName: row.fileName,
      contentType: row.contentType,
      width: row.width,
      height: row.height,
    })),
  }
}
