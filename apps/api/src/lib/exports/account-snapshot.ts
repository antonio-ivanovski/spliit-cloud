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
  const account = await client.account.findUnique({
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

  if (selectedGroupIds.length === 0 && !selection.includeAccountPreferences) {
    throw new InvalidAccountExportSelectionError(
      'Select at least one group or include account preferences.',
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
  }
}
