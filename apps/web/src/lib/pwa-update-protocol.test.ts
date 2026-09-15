import { describe, expect, it } from 'vitest'

import {
  asCoordinationResult,
  asProtocolMessage,
  asRoundResponse,
} from './pwa-update-protocol'

describe('pwa-update-protocol validation', () => {
  it('accepts well-formed protocol message headers', () => {
    expect(
      asProtocolMessage({
        type: 'COORDINATION_PREPARE',
        protocol: 1,
        attemptId: 'a1',
      }),
    ).toEqual({ type: 'COORDINATION_PREPARE', attemptId: 'a1' })
  })

  it('rejects foreign, versioned-out, and shapeless headers', () => {
    expect(asProtocolMessage(null)).toBeNull()
    expect(asProtocolMessage('COORDINATION_PREPARE')).toBeNull()
    expect(asProtocolMessage({ type: 'COORDINATION_PREPARE' })).toBeNull()
    expect(
      asProtocolMessage({ type: 'COORDINATION_PREPARE', protocol: 999 }),
    ).toBeNull()
    expect(
      asProtocolMessage({ type: 'COORDINATION_PREPARE', protocol: 1 }),
    ).toBeNull()
    expect(
      asProtocolMessage({
        type: 'COORDINATION_PREPARE',
        protocol: 1,
        attemptId: '',
      }),
    ).toBeNull()
  })

  it('accepts well-formed FINAL verdicts', () => {
    expect(
      asCoordinationResult({
        type: 'COORDINATION_RESULT',
        protocol: 1,
        activated: true,
      }),
    ).toEqual({ activated: true })
    expect(
      asCoordinationResult({
        type: 'COORDINATION_RESULT',
        protocol: 1,
        activated: false,
        reason: 'peer-blocked',
        clientCount: 2,
      }),
    ).toEqual({ activated: false, reason: 'peer-blocked', clientCount: 2 })
  })

  it('rejects malformed FINAL verdicts so they read as unverified', () => {
    expect(asCoordinationResult({ status: 'accepted' })).toBeNull()
    expect(
      asCoordinationResult({
        type: 'COORDINATION_RESULT',
        protocol: 1,
        activated: false,
        reason: 'peer-blocked',
        clientCount: -1,
      }),
    ).toBeNull()
    expect(
      asCoordinationResult({
        type: 'COORDINATION_RESULT',
        protocol: 1,
        activated: false,
        reason: 'someday',
        clientCount: 1,
      }),
    ).toBeNull()
    expect(
      asCoordinationResult({
        type: 'COORDINATION_RESULT',
        protocol: 999,
        activated: true,
      }),
    ).toBeNull()
  })

  it('scopes round responses to the attempt and status set', () => {
    const valid = ['clean', 'blocked', 'not-ready']
    expect(
      asRoundResponse(
        { protocol: 1, attemptId: 'a1', status: 'clean' },
        'a1',
        valid,
      ),
    ).toBe('clean')
    expect(
      asRoundResponse(
        { protocol: 1, attemptId: 'stale', status: 'clean' },
        'a1',
        valid,
      ),
    ).toBeNull()
    expect(
      asRoundResponse(
        { protocol: 1, attemptId: 'a1', status: 'confirmed' },
        'a1',
        valid,
      ),
    ).toBeNull()
    expect(
      asRoundResponse({ protocol: 2, attemptId: 'a1' }, 'a1', valid),
    ).toBeNull()
  })
})
