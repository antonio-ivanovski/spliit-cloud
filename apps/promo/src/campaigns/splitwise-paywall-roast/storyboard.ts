import { featureSegments } from './features'

/**
 * Approved roast copy. Provider-independent timeline shared by UI, voice and
 * mix.
 */
export const roastStoryboard = {
  compositionId: 'splitwise-paywall-roast',
  voice: 'af_heart',
  speed: 1,
  fps: 30,
  leadFrames: 3,
  resultHoldFrames: 30,
  beats: [
    {
      id: 'hook',
      seconds: 6.8,
      text: 'Four expenses a day. Because apparently adding a fifth expense is a premium feature.',
    },
    {
      id: 'parody',
      seconds: 7.3,
      text: 'You bought pizza. Now enjoy the monetization circus. Crust Coin. Finance your leftovers.',
    },
    {
      id: 'reveal',
      seconds: 4.2,
      text: 'Spliit Cloud. Finally, just split the damn bill.',
    },
    {
      id: 'expenses',
      seconds: 5.0,
      text: 'A fifth expense. Somehow, civilization survived.',
    },
    {
      id: 'groups',
      seconds: 5.0,
      text: 'Split with the whole group. Skip the paywall drama.',
    },
    {
      id: 'friends',
      seconds: 4.6,
      text: 'Two friends. One bill. Zero paywall bullshit.',
    },
    {
      id: 'import',
      seconds: 7.0,
      text: 'Bring your whole group’s expenses. Leave the paywall bullshit behind.',
    },
    {
      id: 'avalanche',
      seconds: 165 / 30,
      text: featureSegments.map((segment) => segment.text).join('. '),
      segments: featureSegments,
      resultHoldFrames: 0,
    },
    {
      id: 'stop',
      seconds: 4.2,
      text: "We're not reading all that. And you're not paying for it.",
    },
    {
      id: 'finish',
      seconds: 13.0,
      text: 'Free. Open source. Yours to fork. Self-hostable. Your bills are expensive enough. Ditch the paywall. Try the free public instance at Spliit dot cloud.',
    },
  ],
}
export const roastTimeline = roastStoryboard.beats.map(
  (beat, index, beats) => ({
    ...beat,
    from: beats
      .slice(0, index)
      .reduce(
        (sum, entry) => sum + Math.round(entry.seconds * roastStoryboard.fps),
        0,
      ),
    durationInFrames: Math.round(beat.seconds * roastStoryboard.fps),
  }),
)
export const roastDuration = roastTimeline.reduce(
  (sum, beat) => sum + beat.durationInFrames,
  0,
)
export const roastBeats = Object.fromEntries(
  roastTimeline.map((beat) => [beat.id, beat]),
)
