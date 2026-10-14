import type { ExpenseFormItemValues } from '@spliit/domain'

import { narrationTimeline } from '../video/narration-timeline'
import { receipt, participants } from './receipt-fixture'

export const receiptAiStoryboard = {
  compositionId: 'receipt-walkthrough-ai',
  voice: 'af_nicole',
  speed: 1,
  fps: 30,
  leadFrames: 18,
  resultHoldFrames: 60,
  beats: [
    {
      id: 'intro-feature',
      seconds: 16,
      text: 'Turn a receipt into a shared expense with Spliit Cloud. It extracts the details and items. You choose who shares each item.',
    },
    {
      id: 'intro-speed',
      seconds: 18,
      text: 'In version two point seven, receipt scanning is roughly five times faster. Smaller receipts scan in under ten seconds, with line items extracted.',
    },
    {
      id: 'upload',
      seconds: 8,
      text: 'Scan a receipt. Create a shared expense.',
      actionOffsetFrames: 165,
    },
    { id: 'extract-ocr', seconds: 7, text: 'OCR reads the receipt text.' },
    {
      id: 'extract-llm',
      seconds: 11,
      text: 'A language model structures expense details, with vision as a fallback.',
    },
    {
      id: 'extract-jev',
      seconds: 11,
      text: 'Jev suggests categories. Designed to balance speed, quality, and cost.',
    },
    {
      id: 'review',
      seconds: 8,
      text: 'Review the extraction. Then open Edit details.',
      actionOffsetFrames: 195,
    },
    {
      id: 'coffee-edit',
      seconds: 7,
      text: 'Open coffee’s participant controls.',
      actionOffsetFrames: 165,
    },
    {
      id: 'itemized-confirm',
      seconds: 7,
      text: 'Switch to itemized splitting.',
      actionOffsetFrames: 150,
    },
    { id: 'coffee-open', seconds: 5, text: 'Coffee starts shared.' },
    {
      id: 'coffee-select',
      seconds: 7,
      text: 'Deselect Alex. Keep Jamie.',
      actionOffsetFrames: 150,
    },
    {
      id: 'coffee-save',
      seconds: 6,
      text: 'Save the participants.',
      actionOffsetFrames: 105,
    },
    {
      id: 'save',
      seconds: 8,
      text: 'Milk and pasta stay shared. Create the expense.',
      actionOffsetFrames: 195,
    },
    {
      id: 'result',
      seconds: 8,
      text: 'Alex: four dollars. Jamie: sixteen fifty.',
    },
    {
      id: 'outro',
      seconds: 10,
      text: 'Try Spliit Cloud for your next shared expense. Visit spliit dot cloud.',
    },
  ],
}
export const receiptAiTimeline = narrationTimeline(receiptAiStoryboard)
const beat = (id: string) => {
  const found = receiptAiTimeline.find((entry) => entry.id === id)
  if (!found) throw new Error(`Missing receipt AI beat: ${id}`)
  return found
}
export const receiptAiBeats = {
  introFeature: beat('intro-feature'),
  introSpeed: beat('intro-speed'),
  upload: beat('upload'),
  ocr: beat('extract-ocr'),
  llm: beat('extract-llm'),
  jev: beat('extract-jev'),
  review: beat('review'),
  coffeeEdit: beat('coffee-edit'),
  confirm: beat('itemized-confirm'),
  coffeeOpen: beat('coffee-open'),
  coffeeSelect: beat('coffee-select'),
  coffeeSave: beat('coffee-save'),
  save: beat('save'),
  result: beat('result'),
  outro: beat('outro'),
}
export const receiptAiDuration = receiptAiTimeline.reduce(
  (sum, beat) => sum + beat.durationInFrames,
  0,
)
const action = (beat: (typeof receiptAiTimeline)[number]) => {
  if (beat.actionOffsetFrames === undefined)
    throw new Error(`No action in ${beat.id}`)
  return beat.from + beat.actionOffsetFrames
}
export const receiptAiActions = {
  upload: action(receiptAiBeats.upload),
  editDetails: action(receiptAiBeats.review),
  openCoffee: action(receiptAiBeats.coffeeEdit),
  itemized: action(receiptAiBeats.confirm),
  selectJamie: action(receiptAiBeats.coffeeSelect),
  saveCoffee: action(receiptAiBeats.coffeeSave),
  createExpense: action(receiptAiBeats.save),
  saved: receiptAiBeats.result.from,
}

/**
 * Saved form values derive from the frame, including when rendering out of
 * order.
 */
export function receiptAiItemsAt(frame: number): ExpenseFormItemValues[] {
  const committed = frame >= receiptAiActions.saveCoffee + 8
  return receipt.items.map((item, index) => ({
    id: `item-${index}`,
    title: item.title,
    unitPrice: item.amount / 100,
    quantity: 1,
    splitMode: 'EVENLY',
    paidFor: participants
      .filter((name) => !committed || index !== 1 || name === 'Jamie')
      .map((name) => ({ participant: name.toLowerCase(), shares: 1 })),
  }))
}
