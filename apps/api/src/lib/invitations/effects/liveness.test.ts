import { describe, expect, it } from 'vitest'

import { GroupInvitationStatus } from '@spliit/db'

import { endedReasonOf, isSharedLinkRow } from './liveness'

const now = new Date('2026-10-19T12:00:00Z')

function multiUseRow(overrides: {
  status?: GroupInvitationStatus
  expiresAt?: Date | null
  useCount?: number
  maxUses?: number | null
}) {
  return {
    status: GroupInvitationStatus.PENDING,
    isMultiUse: true,
    expiresAt: null,
    useCount: 0,
    maxUses: 10,
    ...overrides,
  }
}

describe('invite liveness (single source of truth)', () => {
  it('marks a shared row by the stored token, nothing else', () => {
    expect(isSharedLinkRow({ isMultiUse: true, linkToken: 'abc' })).toBe(true)
    // A multi-use row without a stored token is a QR session, not shared.
    expect(isSharedLinkRow({ isMultiUse: true, linkToken: null })).toBe(false)
    expect(isSharedLinkRow({ isMultiUse: false, linkToken: 'abc' })).toBe(false)
  })

  it('reports live for a capped link under the cap, full at the cap', () => {
    expect(endedReasonOf(multiUseRow({ useCount: 9 }), now)).toBeNull()
    expect(endedReasonOf(multiUseRow({ useCount: 10 }), now)).toBe('full')
    // Over the cap stays full, never "more full".
    expect(endedReasonOf(multiUseRow({ useCount: 11 }), now)).toBe('full')
  })

  it('never reports full for an unlimited link, however many joins', () => {
    const unlimited = multiUseRow({ maxUses: null, useCount: 10_000 })
    expect(endedReasonOf(unlimited, now)).toBeNull()
  })

  it('reports expired by the clock, with expiry winning over a full cap', () => {
    const expired = multiUseRow({
      expiresAt: new Date('2026-10-19T11:59:59Z'),
      useCount: 10,
    })
    expect(endedReasonOf(expired, now)).toBe('expired')
    const live = multiUseRow({
      expiresAt: new Date('2026-10-19T12:00:01Z'),
      useCount: 3,
    })
    expect(endedReasonOf(live, now)).toBeNull()
  })

  it('reports null liveness for non-pending rows without reasoning about caps', () => {
    for (const status of [
      GroupInvitationStatus.ACCEPTED,
      GroupInvitationStatus.REVOKED,
      GroupInvitationStatus.DECLINED,
    ]) {
      expect(
        endedReasonOf(multiUseRow({ status, useCount: 10 }), now),
      ).toBeNull()
    }
  })

  it('ignores the cap machinery for one-time links', () => {
    const oneTime = {
      status: GroupInvitationStatus.PENDING,
      isMultiUse: false,
      expiresAt: null,
      useCount: 0,
      maxUses: null,
    }
    expect(endedReasonOf(oneTime, now)).toBeNull()
    const expired = {
      ...oneTime,
      expiresAt: new Date('2026-10-19T11:00:00Z'),
    }
    expect(endedReasonOf(expired, now)).toBe('expired')
  })
})
