import { describe, expect, test } from 'bun:test'

import {
  receiptAiItemsAt,
  receiptAiActions,
  receiptAiBeats,
} from './campaigns/receipt-ai-storyboard'
import { selectCampaign } from './catalog'

describe('campaign selection', () => {
  test('the existing PNG command selects only static variants', () => {
    const { variants } = selectCampaign('receipt-scan-v2-7-0')
    expect(variants.map(([name]) => name)).toEqual(['promo'])
    expect(
      selectCampaign('currency-rework', 'promo').variants[0][1].width,
    ).toBe(1600)
  })
  test('video exports select video variants and reject static artwork', () => {
    expect(
      selectCampaign('receipt-scan-v2-7-0', undefined, 'video').variants[0][0],
    ).toBe('walkthrough')
    expect(() =>
      selectCampaign('receipt-scan-v2-7-0', 'promo', 'video'),
    ).toThrow('use the render command')
    expect(() => selectCampaign('receipt-scan-v2-7-0', 'walkthrough')).toThrow(
      'render:video or render:poster',
    )
    expect(() => selectCampaign('currency-rework', undefined, 'video')).toThrow(
      'No video variants',
    )
  })
  test('the AI copy selects independent audio and leaves the original duration intact', () => {
    const original = selectCampaign(
      'receipt-scan-v2-7-0',
      'walkthrough',
      'video',
    ).variants[0][1]
    const copy = selectCampaign(
      'receipt-scan-v2-7-0',
      'walkthrough-ai',
      'video',
    ).variants[0][1]
    expect(copy.compositionId).toBe('receipt-walkthrough-ai')
    expect(copy.durationInFrames / copy.fps).toBe(137)
    expect(copy.posterFrame).toBeGreaterThanOrEqual(receiptAiBeats.result.from)
    expect(copy.posterFrame).toBeLessThan(receiptAiBeats.outro.from)
    expect(original.durationInFrames / original.fps).toBe(58)
    expect(copy.narration).not.toBe(original.narration)
    expect(copy.soundDesign).not.toBe(original.soundDesign)
  })
  test('saved item participants follow the frame when scrubbing backwards', () => {
    expect(
      receiptAiItemsAt(receiptAiActions.saveCoffee + 8)[1].paidFor.map(
        (row) => row.participant,
      ),
    ).toEqual(['jamie'])
    // Selecting Jamie in the open draft does not commit the expense item.
    expect(
      receiptAiItemsAt(receiptAiActions.selectJamie + 30)[1].paidFor.map(
        (row) => row.participant,
      ),
    ).toEqual(['alex', 'jamie'])
    expect(
      receiptAiItemsAt(receiptAiActions.saveCoffee + 7)[1].paidFor.map(
        (row) => row.participant,
      ),
    ).toEqual(['alex', 'jamie'])
    expect(
      receiptAiItemsAt(0)[1].paidFor.map((row) => row.participant),
    ).toEqual(['alex', 'jamie'])
  })
  test('unknown selections produce useful errors', () => {
    expect(() => selectCampaign('missing')).toThrow('Unknown campaign')
    expect(() => selectCampaign('currency-rework', 'missing')).toThrow(
      'Unknown variant',
    )
  })
})
