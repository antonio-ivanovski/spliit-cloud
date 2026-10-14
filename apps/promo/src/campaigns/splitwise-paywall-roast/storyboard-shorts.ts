/**
 * YouTube Shorts variation of the Splitwise paywall roast. Vertical 1080x1920,
 * ~30s fast-paced cut: hook + parody (trimmed) + reveal + 5th-expense demo +
 * import escape (trimmed) + quick CTA finish. Drops groups, friends, avalanche
 * and stop beats from the landscape cut. Beat lengths hug the recorded speech
 * (~0.6s padding) to avoid dead air between screens.
 */
export const roastShortsStoryboard = {
  compositionId: 'splitwise-paywall-roast-shorts',
  voice: 'af_heart',
  speed: 1,
  fps: 30,
  leadFrames: 2,
  resultHoldFrames: 10,
  beats: [
    {
      id: 'hook',
      seconds: 6.0,
      text: 'Four expenses a day. Because apparently adding a fifth expense is a premium feature.',
    },
    {
      id: 'parody',
      seconds: 5.0,
      text: 'You bought pizza. Welcome to the monetization circus. CrustCoin.',
    },
    {
      id: 'reveal',
      seconds: 3.7,
      text: 'Spliit Cloud. Finally, just split the damn bill.',
    },
    {
      id: 'expenses',
      seconds: 4.2,
      text: 'A fifth expense. Somehow, civilization survived.',
    },
    {
      id: 'import',
      seconds: 4.7,
      text: 'Bring your whole group’s expenses. Leave the paywall bullshit behind.',
    },
    {
      id: 'finish',
      seconds: 6.0,
      text: 'Free. Open source. Yours to fork. Ditch the paywall. Try Spliit Cloud.',
    },
  ],
}
export const roastShortsTimeline = roastShortsStoryboard.beats.map(
  (beat, index, beats) => ({
    ...beat,
    from: beats
      .slice(0, index)
      .reduce(
        (sum, entry) =>
          sum + Math.round(entry.seconds * roastShortsStoryboard.fps),
        0,
      ),
    durationInFrames: Math.round(beat.seconds * roastShortsStoryboard.fps),
  }),
)
export const roastShortsDuration = roastShortsTimeline.reduce(
  (sum, beat) => sum + beat.durationInFrames,
  0,
)
export const roastShortsBeats = Object.fromEntries(
  roastShortsTimeline.map((beat) => [beat.id, beat]),
)
