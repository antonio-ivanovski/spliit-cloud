import { formatList, formatNumber } from '@spliit/domain'
import type { SplitMode } from '@spliit/domain'

type Target = 'PAID_BY' | 'PAID_FOR'

type Participant = {
  id: string
  name: string
}

type DistributionRow = {
  participant: string
  shares: number
}

type Translate = (key: string, options?: Record<string, unknown>) => string

type GeneratedNameInput = {
  target: Target
  splitMode: Exclude<SplitMode, 'BY_AMOUNT' | 'ITEMIZED'>
  rows: DistributionRow[]
  participants: Participant[]
  locale: string
  t: Translate
  sharesAreStored?: boolean
}

function participantName(row: DistributionRow, participants: Participant[]) {
  return (
    participants.find((participant) => participant.id === row.participant)
      ?.name ?? row.participant
  )
}

function visibleRows(rows: DistributionRow[], participants: Participant[]) {
  const selected = rows.filter((row) => Number(row.shares) > 0)
  const named = selected.map((row) => ({
    ...row,
    name: participantName(row, participants),
  }))
  return {
    selected: named,
    visible: named.slice(0, 3),
    hiddenCount: Math.max(0, named.length - 3),
  }
}

function clampName(value: string) {
  const normalized = value.trim()
  if (normalized.length <= 120) return normalized
  let prefix = normalized
  while (`${prefix}…`.length > 120) {
    prefix = Array.from(prefix).slice(0, -1).join('')
  }
  return `${prefix}…`
}

function appendOthers(
  names: string[],
  hiddenCount: number,
  locale: string,
  t: Translate,
) {
  if (hiddenCount === 0) return names
  return [
    ...names,
    t('splitPresets.autoName.moreParticipants', {
      count: hiddenCount,
      formattedCount: formatNumber(hiddenCount, locale),
    }),
  ]
}

function storedValue(row: DistributionRow, input: GeneratedNameInput) {
  if (
    input.sharesAreStored &&
    (input.splitMode === 'BY_SHARES' || input.splitMode === 'BY_PERCENTAGE')
  ) {
    return row.shares / 100
  }
  return row.shares
}

function groupedRows(rows: DistributionRow[], input: GeneratedNameInput) {
  const groups: Array<{ value: number; rows: DistributionRow[] }> = []
  for (const row of rows) {
    const value = storedValue(row, input)
    const group = groups.find((candidate) => candidate.value === value)
    if (group) group.rows.push(row)
    else groups.push({ value, rows: [row] })
  }
  return groups
}

export function generatedSplitPresetName(input: GeneratedNameInput) {
  const { selected, visible, hiddenCount } = visibleRows(
    input.rows,
    input.participants,
  )
  if (selected.length === 0) return ''

  const allParticipants = selected.length === input.participants.length
  const names = appendOthers(
    visible.map((row) => row.name),
    hiddenCount,
    input.locale,
    input.t,
  )
  const nameList = formatList(names, input.locale)

  if (input.splitMode === 'EVENLY') {
    if (input.target === 'PAID_BY') {
      if (selected.length === 1) {
        return clampName(
          input.t('splitPresets.autoName.paidBySingle', {
            name: names[0],
          }),
        )
      }
      return clampName(
        allParticipants
          ? input.t('splitPresets.autoName.paidByEveryone')
          : input.t('splitPresets.autoName.paidByEvenly', { names: nameList }),
      )
    }
    if (selected.length === 1) {
      return clampName(
        input.t('splitPresets.autoName.paidForFull', {
          name: names[0],
        }),
      )
    }
    return clampName(
      allParticipants
        ? input.t('splitPresets.autoName.paidForEveryone')
        : input.t('splitPresets.autoName.paidForEvenly', { names: nameList }),
    )
  }

  if (selected.length === 1) {
    return clampName(
      input.t(
        input.target === 'PAID_BY'
          ? 'splitPresets.autoName.paidBySingle'
          : 'splitPresets.autoName.paidForFull',
        { name: selected[0]!.name },
      ),
    )
  }

  const groups = groupedRows(selected, input)
  if (groups.length === 1) {
    const equalNames = appendOthers(
      selected.slice(0, 3).map((row) => row.name),
      Math.max(0, selected.length - 3),
      input.locale,
      input.t,
    )
    const equalList = formatList(equalNames, input.locale)
    return clampName(
      input.target === 'PAID_BY'
        ? input.t('splitPresets.autoName.paidByEvenly', { names: equalList })
        : input.t('splitPresets.autoName.paidForEvenly', {
            names: equalList,
          }),
    )
  }

  const renderedGroups = groups.slice(0, 3).map((group) => {
    const groupRows = group.rows.slice(0, 3)
    const groupNames = appendOthers(
      groupRows.map((row) => participantName(row, input.participants)),
      Math.max(0, group.rows.length - groupRows.length),
      input.locale,
      input.t,
    )
    const displayValue =
      input.splitMode === 'BY_PERCENTAGE'
        ? `${formatNumber(group.value, input.locale, { maximumFractionDigits: 2 })}%`
        : `${formatNumber(group.value, input.locale, { maximumFractionDigits: 2 })} ${input.t('splitPresets.autoName.share', { count: group.value })}`
    if (group.rows.length === 1) {
      return input.t(
        input.target === 'PAID_BY'
          ? 'splitPresets.autoName.paidByItem'
          : 'splitPresets.autoName.paidForItem',
        { name: groupNames[0], value: displayValue },
      )
    }
    return input.t(
      input.target === 'PAID_BY'
        ? 'splitPresets.autoName.paidByGroup'
        : 'splitPresets.autoName.paidForGroup',
      { names: formatList(groupNames, input.locale), value: displayValue },
    )
  })
  const omittedGroups = groups
    .slice(3)
    .reduce((count, group) => count + group.rows.length, 0)
  if (omittedGroups > 0) {
    renderedGroups.push(
      input.t('splitPresets.autoName.moreParticipants', {
        count: omittedGroups,
        formattedCount: formatNumber(omittedGroups, input.locale),
      }),
    )
  }
  return clampName(renderedGroups.join(' · '))
}

export function uniqueGeneratedSplitPresetName(
  suggestion: string,
  names: string[],
) {
  const normalize = (value: string) =>
    value.trim().normalize('NFKC').toLowerCase()
  const occupied = new Set(names.map(normalize))
  if (!occupied.has(normalize(suggestion))) return suggestion

  for (let suffix = 2; Number.isSafeInteger(suffix); suffix += 1) {
    const suffixText = ` (${suffix})`
    const maxBaseLength = 120 - suffixText.length
    let base = suggestion.trim()
    while (base.length > maxBaseLength) {
      base = Array.from(base).slice(0, -1).join('')
    }
    base = base.trimEnd()
    const candidate = `${base}${suffixText}`
    if (!occupied.has(normalize(candidate))) return candidate
  }
  throw new Error('Unable to generate a unique split preset name')
}
