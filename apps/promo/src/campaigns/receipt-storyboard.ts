/**
 * Spoken explanations and UI beats share a timeline; cents stay in
 * receipt-fixture.
 */
export const receiptStoryboard = {
  compositionId: 'receipt-walkthrough',
  voice: 'af_nicole',
  speed: 1,
  fps: 30,
  leadFrames: 12,
  resultHoldFrames: 60,
  beats: [
    {
      id: 'upload',
      seconds: 7,
      text: 'Scan a receipt. Create a shared expense.',
    },
    {
      id: 'extract',
      seconds: 6,
      text: 'AI reads the total and items.',
    },
    {
      id: 'review',
      seconds: 7.5,
      text: 'Review the extraction. Then open Edit details.',
    },
    {
      id: 'itemized',
      seconds: 7.5,
      text: 'Choose By items to set individual participants.',
    },
    {
      id: 'coffee-open',
      seconds: 5,
      text: 'Open the coffee participants.',
    },
    {
      id: 'coffee-select',
      seconds: 5.5,
      text: 'Deselect Alex. Keep Jamie.',
    },
    { id: 'coffee-save', seconds: 4.5, text: 'Save the participants.' },
    {
      id: 'save',
      seconds: 7,
      text: 'Milk and pasta stay shared. Create the expense.',
    },
    {
      id: 'result',
      seconds: 8,
      text: 'Alex: four dollars. Jamie: sixteen fifty.',
    },
  ],
}
export const receiptTimeline = receiptStoryboard.beats.map(
  (beat, index, beats) => ({
    ...beat,
    from: beats
      .slice(0, index)
      .reduce((sum, entry) => sum + entry.seconds * receiptStoryboard.fps, 0),
    durationInFrames: beat.seconds * receiptStoryboard.fps,
  }),
)
export const receiptDuration = receiptTimeline.reduce(
  (sum, beat) => sum + beat.durationInFrames,
  0,
)

/** Absolute action frames shared by the UI and sound cues. */
export const receiptActionFrames = {
  upload: receiptTimeline[0].durationInFrames - 35,
  editDetails:
    receiptTimeline[2].from + receiptTimeline[2].durationInFrames - 25,
  itemized: receiptTimeline[3].from + 90,
  openCoffee: receiptTimeline[4].from + 60,
  selectJamie: receiptTimeline[5].from + 60,
  saveCoffee: receiptTimeline[6].from + 60,
  createExpense:
    receiptTimeline[7].from + receiptTimeline[7].durationInFrames - 25,
  saved: receiptTimeline[8].from,
}
