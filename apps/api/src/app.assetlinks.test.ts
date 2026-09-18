import { describe, expect, it } from 'vitest'

import './test/mocks'
import { app } from './app'
import {
  getAssetLinksStatements,
  normalizeFingerprint,
  parseFingerprints,
} from './lib/assetlinks'

const UPLOAD_SHA_COLON =
  '62:5D:FC:7C:F5:CE:4F:D9:CF:47:9D:2D:AC:9C:06:1E:73:4F:4C:C1:DA:CD:64:D7:DD:4F:57:51:83:3D:18:E4'
const UPLOAD_SHA_COMPACT =
  '625DFC7CF5CE4FD9CF479D2DAC9C061E734F4CC1DACD64D7DD4F5751833D18E4'
const PLAY_SIGNING_SHA_COMPACT = `${'A1'.repeat(32)}`

describe('assetlinks fingerprints', () => {
  it('normalizes colon-separated keytool output to compact uppercase hex', () => {
    expect(normalizeFingerprint(UPLOAD_SHA_COLON)).toBe(UPLOAD_SHA_COMPACT)
    expect(normalizeFingerprint(UPLOAD_SHA_COMPACT.toLowerCase())).toBe(
      UPLOAD_SHA_COMPACT,
    )
  })

  it('rejects malformed fingerprints instead of shipping them', () => {
    expect(normalizeFingerprint('REPLACE_ME_WITH_UPLOAD_KEY_SHA256')).toBeUndefined()
    expect(normalizeFingerprint('A1B2')).toBeUndefined()
    expect(parseFingerprints('not-a-fingerprint')).toEqual([])
  })

  it('dedupes comma-separated fingerprints', () => {
    expect(
      parseFingerprints(
        `${UPLOAD_SHA_COLON}, ${UPLOAD_SHA_COMPACT}, ${PLAY_SIGNING_SHA_COMPACT}`,
      ),
    ).toEqual([UPLOAD_SHA_COMPACT, PLAY_SIGNING_SHA_COMPACT])
  })
})

describe('assetlinks statements', () => {
  it('builds the TWA statement for a configured instance', () => {
    expect(
      getAssetLinksStatements({
        TWA_PACKAGE_NAME: 'cloud.spliit.twa',
        TWA_SHA256_FINGERPRINTS: `${UPLOAD_SHA_COLON},${PLAY_SIGNING_SHA_COMPACT}`,
      }),
    ).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'cloud.spliit.twa',
          sha256_cert_fingerprints: [
            UPLOAD_SHA_COMPACT,
            PLAY_SIGNING_SHA_COMPACT,
          ],
        },
      },
    ])
  })

  it('returns undefined when the package or fingerprints are missing', () => {
    expect(getAssetLinksStatements({})).toBeUndefined()
    expect(
      getAssetLinksStatements({ TWA_PACKAGE_NAME: 'cloud.spliit.twa' }),
    ).toBeUndefined()
    expect(
      getAssetLinksStatements({
        TWA_SHA256_FINGERPRINTS: UPLOAD_SHA_COMPACT,
      }),
    ).toBeUndefined()
  })
})

describe('assetlinks route', () => {
  it('404s honestly when no TWA is configured', async () => {
    // The test environment sets no TWA_* vars, so the singleton env leaves
    // the instance unconfigured.
    const response = await app.request('/.well-known/assetlinks.json')

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
  })
})
