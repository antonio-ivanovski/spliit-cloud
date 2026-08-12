export type MascotSpeechMessageKey =
  | 'Mascot.noActionMessage'
  | 'Mascot.hintReceiptVoice'
  | 'Mascot.hintSettle'
  | 'Mascot.hintSettings'
  | 'Mascot.hintTapToAddExpense'
  | 'Mascot.hintTapToCreateGroup'

export type MascotSpeechLine = {
  id: string
  messageKey: MascotSpeechMessageKey
  showSettings: boolean
}

export function isGroupPath(pathname: string) {
  return (
    /^\/groups\/[^/]+/.test(pathname) &&
    pathname !== '/groups/create' &&
    !pathname.startsWith('/groups/import') &&
    !pathname.startsWith('/groups/bulk-categorize')
  )
}

export function isSettingsPath(pathname: string) {
  return pathname.startsWith('/account/settings')
}

export function buildMascotSpeechCycle({
  pathname,
  aiReceiptOrVoice,
  settingsDiscovered,
}: {
  pathname: string
  aiReceiptOrVoice: boolean
  settingsDiscovered: boolean
}): MascotSpeechLine[] {
  const settingsPage = isSettingsPath(pathname)
  const lines: MascotSpeechLine[] = [
    {
      id: 'empty',
      messageKey: 'Mascot.noActionMessage',
      showSettings: false,
    },
  ]

  if (!settingsPage && aiReceiptOrVoice) {
    lines.push({
      id: 'receipt-voice',
      messageKey: 'Mascot.hintReceiptVoice',
      showSettings: false,
    })
  }

  if (!settingsPage && isGroupPath(pathname)) {
    lines.push({
      id: 'settle',
      messageKey: 'Mascot.hintSettle',
      showSettings: false,
    })
  }

  if (!settingsDiscovered) {
    lines.push({
      id: 'settings',
      messageKey: 'Mascot.hintSettings',
      showSettings: true,
    })
  }

  return lines
}

export function isCoachSpeechLine(line: MascotSpeechLine | null) {
  return Boolean(line?.id.startsWith('coach-'))
}

export function coachSpeechForActions(
  actionIds: readonly string[],
): MascotSpeechLine | null {
  if (actionIds.includes('add-expense')) {
    return {
      id: 'coach-expense',
      messageKey: 'Mascot.hintTapToAddExpense',
      showSettings: false,
    }
  }
  if (actionIds.includes('create-group')) {
    return {
      id: 'coach-group',
      messageKey: 'Mascot.hintTapToCreateGroup',
      showSettings: false,
    }
  }
  return null
}
