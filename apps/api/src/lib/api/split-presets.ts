import { prisma, type Prisma } from '@spliit/db'
import type { SavedSplitPreset } from '@spliit/domain'

const MAX_STORED_SHARES = 100_000_000

export type SplitPresetClient = Prisma.TransactionClient | typeof prisma
export type SplitPresetScope = 'SHARED' | 'PERSONAL'
export type SplitPresetTarget = 'PAID_BY' | 'PAID_FOR'

export function normalizeSplitPresetName(input: string) {
  const name = input.trim()
  return {
    name,
    nameKey: name.normalize('NFKC').toLowerCase(),
  }
}

export function scopeKeyFor(scope: SplitPresetScope, accountId?: string) {
  if (scope === 'SHARED') return 'GROUP'
  if (!accountId) throw new Error('Personal preset scope requires an account')
  return `ACCOUNT:${accountId}`
}

export function canonicalizePreset(preset: SavedSplitPreset) {
  return {
    ...preset,
    participants:
      preset.splitMode === 'EVENLY'
        ? preset.participants.map(({ participant }) => ({
            participant,
            shares: 1,
          }))
        : preset.participants.map(({ participant, shares }) => ({
            participant,
            shares,
          })),
  }
}

function normalizedPercentageRows(
  rows: Array<{ participantId: string; shares: number }>,
) {
  const total = rows.reduce((sum, row) => sum + row.shares, 0)
  if (total <= 0) return []

  const scaled = rows.map((row) => {
    const numerator = row.shares * 10_000
    const floor = Math.floor(numerator / total)
    return {
      ...row,
      shares: floor,
      remainder: numerator - floor * total,
    }
  })
  let remainder = 10_000 - scaled.reduce((sum, row) => sum + row.shares, 0)
  scaled.sort(
    (left, right) =>
      right.remainder - left.remainder ||
      (left.participantId < right.participantId
        ? -1
        : left.participantId > right.participantId
          ? 1
          : 0),
  )
  for (let index = 0; index < scaled.length && remainder > 0; index += 1) {
    scaled[index]!.shares += 1
    remainder -= 1
  }
  return scaled
    .toSorted((left, right) =>
      left.participantId < right.participantId
        ? -1
        : left.participantId > right.participantId
          ? 1
          : 0,
    )
    .map(({ participantId, shares }) => ({ participantId, shares }))
}

export function adjustSplitPresetRows(
  splitMode: 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE',
  remaining: Array<{ participantId: string; shares: number }>,
) {
  if (splitMode === 'BY_PERCENTAGE') return normalizedPercentageRows(remaining)
  return remaining.map((row) => ({
    participantId: row.participantId,
    shares: splitMode === 'EVENLY' ? 1 : row.shares,
  }))
}

function boundedShareRows(
  rows: Array<{ participantId: string; shares: number }>,
) {
  const largest = Math.max(...rows.map((row) => row.shares))
  if (largest <= MAX_STORED_SHARES) return rows

  return rows.map((row) => ({
    ...row,
    // Identity merges can combine two individually valid maximum shares.
    // Shares are relative, so scaling every row by the same factor preserves
    // the distribution while keeping the stored representation readable.
    shares: Math.max(1, Math.round((row.shares * MAX_STORED_SHARES) / largest)),
  }))
}

/** Move preset references during an identity merge instead of pruning them. */
export async function mergeSplitPresetParticipantReferences(
  sourceId: string,
  targetId: string,
  client: SplitPresetClient = prisma,
) {
  const presets =
    (await client.splitPreset.findMany({
      where: { participants: { some: { participantId: sourceId } } },
      include: { participants: true },
    })) ?? []

  for (const preset of presets) {
    const combined = new Map<string, number>()
    for (const row of preset.participants) {
      const participantId =
        row.participantId === sourceId ? targetId : row.participantId
      const shares = preset.splitMode === 'EVENLY' ? 1 : row.shares
      combined.set(
        participantId,
        preset.splitMode === 'EVENLY'
          ? 1
          : (combined.get(participantId) ?? 0) + shares,
      )
    }

    let nextRows = [...combined].map(([participantId, shares]) => ({
      participantId,
      shares,
    }))
    if (preset.splitMode === 'BY_SHARES') {
      nextRows = boundedShareRows(nextRows)
    }

    await client.splitPresetParticipant.deleteMany({
      where: { presetId: preset.id },
    })
    await client.splitPresetParticipant.createMany({
      data: nextRows.map((row) => ({ presetId: preset.id, ...row })),
    })
    await client.splitPreset.update({
      where: { id: preset.id },
      data: { updatedAt: new Date() },
    })
  }
}

export async function clearPresetDefaultTarget(
  presetId: string,
  target: SplitPresetTarget,
  client: SplitPresetClient,
) {
  const presetField =
    target === 'PAID_BY' ? 'paidByDefaultPresetId' : 'paidForDefaultPresetId'
  const modeField =
    target === 'PAID_BY' ? 'paidByDefaultMode' : 'paidForDefaultMode'
  await client.accountGroupPreference.updateMany({
    where: { [presetField]: presetId },
    data: { [presetField]: null, [modeField]: 'INHERIT' },
  })
  await client.group.updateMany({
    where: {
      [target === 'PAID_BY'
        ? 'defaultPaidByPresetId'
        : 'defaultPaidForPresetId']: presetId,
    },
    data: {
      [target === 'PAID_BY'
        ? 'defaultPaidByPresetId'
        : 'defaultPaidForPresetId']: null,
    },
  })
}

export async function clearPresetDefaults(
  presetId: string,
  client: SplitPresetClient,
) {
  await clearPresetDefaultTarget(presetId, 'PAID_BY', client)
  await clearPresetDefaultTarget(presetId, 'PAID_FOR', client)
}

/** Adjust one-sided shared and personal presets in the caller's transaction. */
export async function adjustSplitPresetsForRemovedParticipant(
  participantId: string,
  client: SplitPresetClient = prisma,
) {
  const presets =
    (await client.splitPreset.findMany({
      where: { participants: { some: { participantId } } },
      include: { participants: true },
    })) ?? []

  for (const preset of presets) {
    const remaining = preset.participants
      .filter((row) => row.participantId !== participantId)
      .map(({ participantId: id, shares }) => ({
        participantId: id,
        shares,
      }))
    const nextRows = adjustSplitPresetRows(
      preset.splitMode as 'EVENLY' | 'BY_SHARES' | 'BY_PERCENTAGE',
      remaining,
    )

    if (nextRows.length === 0) {
      await clearPresetDefaults(preset.id, client)
      await client.splitPreset.delete({ where: { id: preset.id } })
      continue
    }

    await client.splitPresetParticipant.deleteMany({
      where: { presetId: preset.id },
    })
    await client.splitPresetParticipant.createMany({
      data: nextRows.map((row) => ({
        presetId: preset.id,
        participantId: row.participantId,
        shares: row.shares,
      })),
    })
    await client.splitPreset.update({
      where: { id: preset.id },
      data: { updatedAt: new Date() },
    })
  }
}

export async function deletePersonalPresetsForAccount(
  groupId: string,
  accountId: string,
  client: SplitPresetClient = prisma,
) {
  const presets =
    (await client.splitPreset.findMany({
      where: { groupId, ownerAccountId: accountId },
      select: { id: true },
    })) ?? []
  for (const preset of presets) await clearPresetDefaults(preset.id, client)
  await client.splitPreset.deleteMany({
    where: { groupId, ownerAccountId: accountId },
  })
  await client.accountGroupPreference.updateMany({
    where: { groupId, accountId },
    data: {
      paidByDefaultMode: 'INHERIT',
      paidByDefaultPresetId: null,
      paidForDefaultMode: 'INHERIT',
      paidForDefaultPresetId: null,
    },
  })
}
