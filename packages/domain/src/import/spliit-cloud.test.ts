import { describe, expect, it } from '@effect/vitest'

import {
  classifyImportBytes,
  classifyImportPayload,
  classifyImportText,
  hasZipSignature,
} from './spliit-cloud'

describe('spliit cloud source classification', () => {
  it('recognizes all supported ZIP signatures', () => {
    expect(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe(
      true,
    )
    expect(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x05, 0x06]))).toBe(
      true,
    )
    expect(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x07, 0x08]))).toBe(
      true,
    )
    expect(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x00, 0x00]))).toBe(
      false,
    )
  })

  it('classifies a ZIP by its signature regardless of file metadata', () => {
    expect(
      classifyImportBytes(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])),
    ).toEqual({ kind: 'SPLIIT_CLOUD_BUNDLE' })
    expect(classifyImportBytes(Uint8Array.from([0x7b, 0x00]))).toEqual({
      kind: 'UNKNOWN',
    })
  })

  it('distinguishes legacy JSON, Cloud group manifests, and account manifests', () => {
    expect(
      classifyImportPayload({
        id: 'g1',
        name: 'Trip',
        currency: '$',
        participants: [{ id: 'p1', name: 'A' }],
        expenses: [],
      }),
    ).toEqual({ kind: 'SPLIIT_APP_JSON' })
    expect(
      classifyImportPayload({
        format: 'spliit.cloud/export',
        scope: { type: 'GROUP' },
      }),
    ).toEqual({ kind: 'SPLIIT_CLOUD_MANIFEST', scope: 'GROUP' })
    expect(
      classifyImportPayload({
        format: 'spliit.cloud/export',
        scope: { type: 'ACCOUNT' },
      }),
    ).toEqual({ kind: 'SPLIIT_CLOUD_MANIFEST', scope: 'ACCOUNT' })
  })

  it('recognizes a legacy CSV only when the Spliit parser accepts it', () => {
    const valid =
      '"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John ","Jane"\n' +
      '"2026-01-12","Dinner","Dining Out","EUR","10.00",,,,"No","Evenly",5.00,-5.00'
    expect(classifyImportText('export.csv', valid)).toEqual({
      kind: 'SPLIIT_APP_CSV',
    })
    expect(classifyImportText('export.csv', 'other')).toEqual({
      kind: 'UNKNOWN',
    })
  })

  it('uses payload content when an export has a misleading extension', () => {
    expect(
      classifyImportText(
        'download.bin',
        JSON.stringify({
          id: 'g1',
          name: 'Trip',
          currency: '$',
          participants: [{ id: 'p1', name: 'A' }],
          expenses: [],
        }),
      ),
    ).toEqual({ kind: 'SPLIIT_APP_JSON' })
    expect(
      classifyImportText(
        'download.bin',
        '"Date","Description","Category","Currency","Cost","Original cost","Original currency","Conversion rate","Is Reimbursement","Split mode","John "\n' +
          '"2026-01-12","Dinner","Dining Out","EUR","10.00",,,,"No","Evenly",10.00',
      ),
    ).toEqual({
      kind: 'SPLIIT_APP_CSV',
    })
    expect(classifyImportText('download.json', 'other')).toEqual({
      kind: 'UNKNOWN',
    })
  })
})
