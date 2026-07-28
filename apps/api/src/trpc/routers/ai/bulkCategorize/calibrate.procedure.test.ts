import { describe, expect, it } from 'vitest'

import { renderCalibrationUserPrompt } from './calibrate.procedure'

describe('renderCalibrationUserPrompt', () => {
  it('asks the AI to select a representative first-round sample', () => {
    const prompt = renderCalibrationUserPrompt({
      round: 1,
      priorFeedback: [],
      candidates: [
        {
          id: 'expense-1',
          title:
            'A very long expense title that should be truncated before it reaches the model',
          expenseDate: new Date('2026-01-01'),
          amount: 1200,
          categoryId: 'general',
        },
      ],
    })

    expect(prompt).toContain('round 1')
    expect(prompt).toContain(
      'Do not choose rows merely because they appear first.',
    )
    expect(prompt).toContain('On the first round, set needsFeedback=true')
    expect(prompt).toContain('within 3 rounds')
    expect(prompt).toContain('This is calibration, not the final preview.')
    expect(prompt).toContain(
      'do not return every expense unless each one is needed to cover a distinct pattern',
    )
    expect(prompt).toContain('expense-1')
    expect(prompt).not.toContain('should be truncated before it reaches')
  })
})
