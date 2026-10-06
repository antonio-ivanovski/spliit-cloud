import { describe, expect, it } from 'vitest'

import {
  buildMascotSpeechCycle,
  coachSpeechForActions,
} from '@/components/mascot/mascot-speech'

describe('mascot speech cycle', () => {
  it('always starts with the empty-route fallback', () => {
    const lines = buildMascotSpeechCycle({
      pathname: '/feedback',
      aiReceiptOrVoice: false,
      settingsDiscovered: true,
    })
    expect(lines).toEqual([
      {
        id: 'empty',
        messageKey: 'Mascot.noActionMessage',
        showSettings: false,
      },
    ])
  })

  it('adds capability and settle hints on a group page', () => {
    const lines = buildMascotSpeechCycle({
      pathname: '/groups/group-1/activity',
      aiReceiptOrVoice: true,
      settingsDiscovered: true,
    })
    expect(lines.map((line) => line.id)).toEqual([
      'empty',
      'receipt-voice',
      'settle',
    ])
  })

  it('keeps settings as the last line until discovered', () => {
    const lines = buildMascotSpeechCycle({
      pathname: '/feedback',
      aiReceiptOrVoice: false,
      settingsDiscovered: false,
    })
    expect(lines.at(-1)).toEqual({
      id: 'settings',
      messageKey: 'Mascot.hintSettings',
      showSettings: true,
    })
  })

  it('skips capability ads on the settings page', () => {
    const lines = buildMascotSpeechCycle({
      pathname: '/account/settings',
      aiReceiptOrVoice: true,
      settingsDiscovered: true,
    })
    expect(lines.map((line) => line.id)).toEqual(['empty'])
  })

  it('picks a tap-to-add coach line from the active actions', () => {
    expect(coachSpeechForActions(['add-expense'])?.messageKey).toBe(
      'Mascot.hintTapToAddExpense',
    )
    expect(coachSpeechForActions(['create-group'])?.messageKey).toBe(
      'Mascot.hintTapToCreateGroup',
    )
    expect(coachSpeechForActions(['import-group'])).toBeNull()
  })
})
