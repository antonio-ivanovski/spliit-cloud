import { describe, expect, it } from 'bun:test'

import { readVersion, releaseMetadata } from './release-metadata'

describe('Android release publication contract', () => {
  it('publishes the signed APK version, checksum, and Android-specific release location', () => {
    const result = releaseMetadata(
      'versionName=1.2.0\nversionCode=12\n',
      'android/v1.2.0',
      'spliit-cloud.apk',
      'ab'.repeat(32),
    )
    expect(result.latest.versionCode).toBe(12)
    expect(result.latest.apkUrl).toBe(
      'https://github.com/antonio-ivanovski/spliit-cloud/releases/download/android/v1.2.0/spliit-cloud.apk',
    )
    expect(result.latest.sha256).toBe('ab'.repeat(32))
  })

  it('refuses mismatched tags, unsigned artifact names, invalid codes, and checksums', () => {
    expect(() =>
      releaseMetadata(
        'versionName=1.2.0\nversionCode=12',
        'v1.2.0',
        'spliit-cloud.apk',
        'ab'.repeat(32),
      ),
    ).toThrow()
    expect(() =>
      releaseMetadata(
        'versionName=1.2.0\nversionCode=12',
        'android/v1.2.0',
        'app-release-unsigned.apk',
        'ab'.repeat(32),
      ),
    ).toThrow()
    expect(() =>
      releaseMetadata(
        'versionName=1.2.0\nversionCode=12',
        'android/v1.2.0',
        'spliit-cloud.apk',
        'invalid',
      ),
    ).toThrow()
    for (const code of ['0', '-1', '2147483648', 'NaN']) {
      expect(() =>
        readVersion(`versionName=1.2.0\nversionCode=${code}`),
      ).toThrow()
    }
  })
})
