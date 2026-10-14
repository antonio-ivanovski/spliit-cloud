import { describe, expect, test } from 'bun:test'

import { parseVideoArgs } from './render-video'

const poster = ['poster', '--campaign', 'receipt-scan-v2-7-0']
describe('video export arguments', () => {
  test('poster exports accept the first and last frames and retain the default', () => {
    expect(parseVideoArgs(poster)).toMatchObject({
      frame: undefined,
      mode: 'poster',
    })
    expect(parseVideoArgs([...poster, '--frame', '0'])).toMatchObject({
      frame: 0,
    })
    expect(parseVideoArgs([...poster, '--frame', '1739'])).toMatchObject({
      frame: 1739,
    })
  })
  test.each(['-1', '1740', '1.5', 'NaN', '', '1e2', '9007199254740993'])(
    'rejects invalid poster frame %s before rendering',
    (frame) => {
      expect(() => parseVideoArgs([...poster, '--frame', frame])).toThrow()
    },
  )
  test('audio modes are video-only', () => {
    const base = ['video', '--campaign', 'receipt-scan-v2-7-0']
    expect(parseVideoArgs([...base, '--no-sound-design'])).toMatchObject({
      noSoundDesign: true,
      silent: false,
    })
    expect(parseVideoArgs([...base, '--silent'])).toMatchObject({
      silent: true,
    })
    expect(() => parseVideoArgs([...poster, '--no-sound-design'])).toThrow()
  })
  test('help needs no campaign and video exports reject poster-only flags', () => {
    expect(parseVideoArgs(['video', '--help'])).toMatchObject({ help: true })
    expect(() => parseVideoArgs(['video'])).toThrow('Missing --campaign')
    expect(() =>
      parseVideoArgs([
        'video',
        '--campaign',
        'receipt-scan-v2-7-0',
        '--frame',
        '0',
      ]),
    ).toThrow()
  })
})
