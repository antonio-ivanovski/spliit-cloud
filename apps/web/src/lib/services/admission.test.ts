import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { OfflineWriteError } from '@/lib/offline/write-guard'

import {
  admitMutationEffect,
  checkAdmission,
  classifyMutationOutcome,
  ensureRequestId,
  IDEMPOTENCY_HEADER,
  withIdempotencyHeader,
} from './admission'

// Authoring gate (test-audit): this file owns the admission contract —
// known-offline rejects, unknown fails open, request IDs stay stable across
// retries, and ambiguous outcomes are explicit. Regression: an unknown
// transport blocking startup mutations would brick the app before the first
// probe; an unstable retry ID would double-post an idempotent create; a
// sent-but-unread mutation silently retried could double-apply. Guard-link
// ordering (before optimism) is owned by write-guard tests; this file owns
// the policy they delegate to. No production seams.

describe('admission policy', () => {
  it.each([
    [
      'unreachable transport',
      'unreachable' as const,
      true,
      'blocked-offline' as const,
    ],
    [
      'browser offline',
      'reachable' as const,
      false,
      'blocked-offline' as const,
    ],
    [
      'both signals offline',
      'unreachable' as const,
      false,
      'blocked-offline' as const,
    ],
    ['reachable and online', 'reachable' as const, true, 'admitted' as const],
    ['unknown fails open', 'unknown' as const, true, 'admitted' as const],
  ])('%s', (_label, transport, navigatorOnline, expected) => {
    expect(checkAdmission({ transport, navigatorOnline })).toBe(expected)
  })

  it('fails the Effect with OfflineWriteError when blocked', async () => {
    const blocked = await Effect.runPromise(
      Effect.flip(
        admitMutationEffect({
          transport: 'unreachable',
          navigatorOnline: true,
        }),
      ),
    )
    expect(blocked).toBeInstanceOf(OfflineWriteError)
    const admitted = await Effect.runPromise(
      admitMutationEffect({ transport: 'reachable', navigatorOnline: true }),
    )
    expect(admitted).toBeUndefined()
  })
})

describe('idempotent request identity', () => {
  it('reuses the caller ID across retries of the same operation', () => {
    expect(ensureRequestId({ requestId: 'logical-1' })).toBe('logical-1')
    expect(ensureRequestId({ requestId: 'logical-1' })).toBe('logical-1')
  })

  it('generates an ID once when the caller has none', () => {
    const generated = ensureRequestId({ newId: () => 'generated-1' })
    expect(generated).toBe('generated-1')
    expect(ensureRequestId({})).not.toBe('')
  })

  it('attaches the header without clobbering an existing one', () => {
    const attached = withIdempotencyHeader({ method: 'POST' }, 'req-1')
    expect(new Headers(attached.headers).get(IDEMPOTENCY_HEADER)).toBe('req-1')
    const kept = withIdempotencyHeader(
      { headers: { [IDEMPOTENCY_HEADER]: 'original' } },
      'req-2',
    )
    expect(new Headers(kept.headers).get(IDEMPOTENCY_HEADER)).toBe('original')
  })
})

describe('mutation outcome classification', () => {
  it('keeps ambiguous outcomes explicit instead of retrying', () => {
    expect(
      classifyMutationOutcome({
        admitted: true,
        sent: true,
        responseReadable: true,
      }),
    ).toBe('committed')
    expect(
      classifyMutationOutcome({
        admitted: true,
        sent: true,
        responseReadable: false,
      }),
    ).toBe('ambiguous')
    expect(
      classifyMutationOutcome({
        admitted: false,
        sent: false,
        responseReadable: false,
      }),
    ).toBe('blocked-offline')
    expect(
      classifyMutationOutcome({
        admitted: true,
        sent: false,
        responseReadable: false,
      }),
    ).toBe('blocked-offline')
  })
})
