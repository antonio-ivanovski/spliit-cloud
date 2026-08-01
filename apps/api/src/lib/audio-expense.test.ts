import { describe, expect, it, vi } from 'vitest'

vi.mock('ai', () => ({
  Output: { json: vi.fn(() => ({ type: 'json' })) },
  generateText: vi.fn(),
}))
vi.mock('./ai', () => ({ getModel: vi.fn(async () => ({ modelId: 'test' })) }))
vi.stubEnv('AI_VOICE_MODEL', 'test-voice-model')

const { generateText } = await import('ai')
const { buildAudioExpensePromptForTest, extractExpenseInformationFromAudio } =
  await import('./audio-expense')

const generateTextMock = vi.mocked(generateText)

const group = {
  id: 'group-1',
  name: 'Trip',
  currency: '$',
  currencyCode: 'USD',
}

describe('audio expense extraction', () => {
  it('includes current-group context without asking the model to choose a destination', () => {
    const prompt = buildAudioExpensePromptForTest({
      audioDataUrl: 'data:audio/wav;base64,AAAA',
      locale: 'en-US',
      group,
      participants: [{ id: 'p-1', name: 'Alex' }],
    })

    expect(prompt).toContain('"name":"Trip"')
    expect(prompt).toContain('"currencyCode":"USD"')
    expect(prompt).toContain('Alex')
    expect(prompt).not.toContain(group.id)
    expect(prompt).toContain('Do not ask for, infer, or return a group ID')
    expect(prompt).toContain('normal writing system and orthography')
  })

  it('normalizes a known-group response and creates typed issues', async () => {
    generateTextMock.mockResolvedValue({
      output: {
        transcript: 'Ajoutez une pizza pour dix euros',
        title: 'Pizza',
        amount: '10',
        currencyCode: 'EUR',
        date: '2026-01-01',
        categoryId: 'food-and-drink',
        payerParticipantId: 'p-1',
        participantIds: ['p-1', 'p-1', 'unknown'],
        languageCode: 'fr',
        languageConfidence: 'high',
      },
    } as never)

    const result = await extractExpenseInformationFromAudio({
      audioDataUrl: 'data:audio/wav;base64,AAAA',
      group,
      participants: [{ id: 'p-1', name: 'Alex' }],
    })

    expect(result).toMatchObject({
      groupId: group.id,
      title: 'Pizza',
      amount: '10',
      currencyCode: 'EUR',
      payerParticipantId: 'p-1',
      participantIds: ['p-1'],
      issues: [],
    })
  })

  it('keeps valid fields when the model returns malformed optional values', async () => {
    generateTextMock.mockResolvedValue({
      output: {
        title: 'Coffee',
        amount: '4.5',
        participantIds: null,
        languageConfidence: 'very-high',
      },
    } as never)

    const result = await extractExpenseInformationFromAudio({
      audioDataUrl: 'data:audio/wav;base64,AAAA',
      group,
      participants: [],
    })

    expect(result).toMatchObject({
      title: 'Coffee',
      amount: '4.5',
      issues: [],
    })
  })

  it('preserves an unsupported spoken currency for the full form', async () => {
    generateTextMock.mockResolvedValue({
      output: {
        title: 'Coffee',
        amount: '4.5',
        currencyCode: 'XYZ',
      },
    } as never)

    const result = await extractExpenseInformationFromAudio({
      audioDataUrl: 'data:audio/wav;base64,AAAA',
      group,
      participants: [],
    })

    expect(result.currencyCode).toBe('XYZ')
    expect(result.issues).toEqual(['unsupportedCurrency'])
  })
})
