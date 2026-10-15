/**
 * Approved storyboard for the Tricount + Settle Up import promo.
 * Provider-independent timeline shared by UI, voice and mix.
 *
 * Beats (all `Spliit Cloud`, never bare `Spliit`):
 *
 * 1. Hook — staged question: Tricount? Or Settle Up? Move out.
 * 2. Roast — opener answers the kicker; both stabs on one screen.
 * 3. Escape — explicit import promise; chips funnel into the Cloud lockup.
 * 4. Family — quick text-only nod: Splitwise was covered long ago.
 * 5. Finish — roast outro verbatim.
 */
export const newImportersStoryboard = {
  compositionId: 'tricount-settleup-import',
  voice: 'af_heart',
  speed: 1,
  fps: 30,
  leadFrames: 3,
  resultHoldFrames: 30,
  beats: [
    {
      id: 'hook',
      seconds: 9.5,
      text: 'Do you split expenses with Tricount? Or Settle Up? Time to move out. Into something free. Open source. Just better.',
    },
    {
      id: 'roast',
      seconds: 17.5,
      text: 'You are asking: why leave? Tricount deleted its export button. Your data back? Email support. Ask nicely. Then wait. Settle Up hands over the CSV. Fair. But ads every third expense? Paywalled receipt photos? Not fair.',
    },
    {
      id: 'escape',
      seconds: 9.5,
      text: 'Good news. Spliit Cloud now imports both. Paste the Tricount link. Drop the Settle Up CSV. Done. Welcome home.',
    },
    {
      id: 'family',
      seconds: 6.0,
      text: 'Used Splitwise before? Spliit Cloud already imported that. You are covered.',
    },
    {
      id: 'finish',
      seconds: 13.0,
      text: 'Free. Open source. Yours to fork. Self-hostable. Your bills are expensive enough. Ditch the paywall. Try the free public instance at Spliit dot cloud.',
    },
  ],
}
export const newImportersTimeline = newImportersStoryboard.beats.map(
  (beat, index, beats) => ({
    ...beat,
    from: beats
      .slice(0, index)
      .reduce(
        (sum, entry) =>
          sum + Math.round(entry.seconds * newImportersStoryboard.fps),
        0,
      ),
    durationInFrames: Math.round(beat.seconds * newImportersStoryboard.fps),
  }),
)
export const newImportersDuration = newImportersTimeline.reduce(
  (sum, beat) => sum + beat.durationInFrames,
  0,
)
export const newImportersBeats = Object.fromEntries(
  newImportersTimeline.map((beat) => [beat.id, beat]),
)
