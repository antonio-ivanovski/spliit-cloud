import { Cause, Effect, Exit, Fiber, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import {
  makePendingExpenseFlush,
  PendingFlushStorageError,
  type PendingExpenseFlushDeps,
  type PendingFlushSummary,
} from './pending-expense-flush'

// Authoring gate (test-audit): this file owns flush coordination —
// createdAt-ordered sends, per-row outcome classification (sent / failed /
// deferred), bounded transient retries, corrupt-row handling, failed-row
// skipping, and storage-failure propagation. Payload validation is owned by
// the shared expenseApiSchema; row-envelope decoding is owned by the Effect
// Schema in the service. The stub store/mutate pair matches the injected
// interface the Dexie adapters and vanilla tRPC client provide.

const NAMESPACE = '["http://localhost:3001","flush-test"]'

function makeExpense(overrides?: Record<string, unknown>) {
  return {
    title: 'Dinner',
    amount: 3000,
    paidByList: [{ participant: 'payer-1', shares: 3000 }],
    paidBySplitMode: 'BY_AMOUNT',
    isMultiPayer: false,
    paidFor: [{ participant: 'payer-1', shares: 1 }],
    category: 'general',
    splitMode: 'EVENLY',
    expenseDate: new Date('2026-03-02T12:00:00.000Z'),
    expenseTimeZone: 'UTC',
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  }
}

function makeRow(overrides?: Record<string, unknown>) {
  return {
    namespace: NAMESPACE,
    groupId: 'g1',
    clientId: 'pending-req-1',
    requestId: '00000000-0000-4000-8000-000000000001',
    createdAtMs: 1_000,
    status: 'pending',
    expense: makeExpense(),
    ...overrides,
  }
}

type MarkCall = { groupId: string; clientId: string; outcome: string }

function harness(overrides?: {
  rows?: unknown[]
  listError?: unknown
  markError?: unknown
  createImpl?: (input: {
    groupId: string
    requestId: string
    expense: unknown
  }) => Promise<{ expenseId: string; recurringSeriesId: string | null }>
}) {
  const calls = {
    created: [] as Array<{ groupId: string; requestId: string }>,
    marked: [] as MarkCall[],
    lists: 0,
  }
  const createImpl = overrides?.createImpl
  const deps: PendingExpenseFlushDeps = {
    listPending: async () => {
      calls.lists += 1
      if (overrides?.listError !== undefined) throw overrides.listError
      return [...(overrides?.rows ?? [])]
    },
    markResult: async (input) => {
      calls.marked.push({
        groupId: input.groupId,
        clientId: input.clientId,
        outcome: input.outcome,
      })
      if (overrides?.markError !== undefined) throw overrides.markError
    },
    createExpense: async (input) => {
      calls.created.push({
        groupId: input.groupId,
        requestId: input.requestId,
      })
      if (createImpl) return createImpl(input)
      return { expenseId: `real-${input.requestId}`, recurringSeriesId: null }
    },
  }
  return { calls, service: makePendingExpenseFlush(deps) }
}

function trpcError(code: string, message: string) {
  return { data: { code }, message }
}

/**
 * Drive a TestClock fiber to settlement (same race-safe stepping as the
 * download tests: a single upfront adjust can fire with nothing scheduled).
 */
const settleFiber = <A, E>(
  fiber: Fiber.Fiber<A, E>,
  until: () => boolean,
  maxSteps = 400,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let step = 0; step < maxSteps; step += 1) {
      if (until()) return
      // Effect v4 exposes only the synchronous pollUnsafe hook.
      const polled = yield* Effect.sync(() => fiber.pollUnsafe())
      if (polled !== undefined) return
      yield* TestClock.adjust('1 second')
    }
    throw new Error('test fiber did not settle in time')
  })

async function runWithClock(
  effect: Effect.Effect<PendingFlushSummary, PendingFlushStorageError>,
): Promise<PendingFlushSummary> {
  const program = Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)
    yield* settleFiber(fiber, () => false)
    return yield* Fiber.join(fiber)
  }).pipe(Effect.provide(TestClock.layer()))
  return Effect.runPromise(program)
}

describe('pending expense flush', () => {
  it('flushes nothing when the outbox is empty', async () => {
    const { calls, service } = harness({ rows: [] })

    const summary = await Effect.runPromise(
      service.flush({ namespace: NAMESPACE }),
    )

    expect(summary).toEqual({ total: 0, sent: 0, failed: 0, deferred: 0 })
    expect(calls.created).toEqual([])
    expect(calls.marked).toEqual([])
  })

  it('sends rows oldest-first and deletes every temp row on success', async () => {
    const rows = [
      makeRow({
        clientId: 'pending-req-3',
        requestId: '00000000-0000-4000-8000-000000000003',
        createdAtMs: 3000,
      }),
      makeRow({
        clientId: 'pending-req-1',
        requestId: '00000000-0000-4000-8000-000000000001',
        createdAtMs: 1000,
      }),
      makeRow({
        clientId: 'pending-req-2',
        requestId: '00000000-0000-4000-8000-000000000002',
        createdAtMs: 2000,
      }),
    ]
    const { calls, service } = harness({ rows })

    const summary = await Effect.runPromise(
      service.flush({ namespace: NAMESPACE }),
    )

    expect(summary).toEqual({ total: 3, sent: 3, failed: 0, deferred: 0 })
    expect(calls.created.map((call) => call.requestId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ])
    expect(calls.marked).toEqual([
      { groupId: 'g1', clientId: 'pending-req-1', outcome: 'sent' },
      { groupId: 'g1', clientId: 'pending-req-2', outcome: 'sent' },
      { groupId: 'g1', clientId: 'pending-req-3', outcome: 'sent' },
    ])
  })

  it('skips already-failed rows without touching the network', async () => {
    const { calls, service } = harness({
      rows: [makeRow({ status: 'failed' })],
    })

    const summary = await Effect.runPromise(
      service.flush({ namespace: NAMESPACE }),
    )

    expect(summary).toEqual({ total: 1, sent: 0, failed: 0, deferred: 0 })
    expect(calls.created).toEqual([])
    expect(calls.marked).toEqual([])
  })

  it('marks corrupt rows failed without sending them', async () => {
    const { calls, service } = harness({
      rows: [
        // Addressable but undecodable (no requestId/expense): marked failed.
        {
          namespace: NAMESPACE,
          groupId: 'g1',
          clientId: 'pending-broken',
          status: 'pending',
        },
        // Not an object at all: counted, nothing durable to mark.
        'junk',
        makeRow(),
      ],
    })

    const summary = await Effect.runPromise(
      service.flush({ namespace: NAMESPACE }),
    )

    expect(summary).toEqual({ total: 3, sent: 1, failed: 2, deferred: 0 })
    expect(calls.created.map((call) => call.requestId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
    ])
    // Corrupt rows resolve in the decode pass, before any send.
    expect(calls.marked).toEqual([
      { groupId: 'g1', clientId: 'pending-broken', outcome: 'failed' },
      { groupId: 'g1', clientId: 'pending-req-1', outcome: 'sent' },
    ])
  })

  it('marks rows with invalid payloads failed without sending them', async () => {
    const { calls, service } = harness({
      rows: [
        makeRow({ expense: makeExpense({ amount: 0 }) }),
        makeRow({
          clientId: 'pending-req-2',
          requestId: '00000000-0000-4000-8000-000000000002',
          createdAtMs: 2000,
          expense: makeExpense({ title: 'x' }),
        }),
      ],
    })

    const summary = await Effect.runPromise(
      service.flush({ namespace: NAMESPACE }),
    )

    expect(summary).toEqual({ total: 2, sent: 0, failed: 2, deferred: 0 })
    expect(calls.created).toEqual([])
    expect(calls.marked).toEqual([
      { groupId: 'g1', clientId: 'pending-req-1', outcome: 'failed' },
      { groupId: 'g1', clientId: 'pending-req-2', outcome: 'failed' },
    ])
  })

  it('marks permanent rejections failed: BAD_REQUEST, different-hash CONFLICT, forbidden', async () => {
    for (const error of [
      trpcError('BAD_REQUEST', 'invalid input'),
      trpcError(
        'CONFLICT',
        'This request ID was already used with different input',
      ),
      trpcError('FORBIDDEN', 'archived'),
    ]) {
      const { calls, service } = harness({
        rows: [makeRow()],
        createImpl: async () => {
          throw error
        },
      })

      const summary = await runWithClock(
        service.flush({ namespace: NAMESPACE }),
      )

      expect(summary).toEqual({ total: 1, sent: 0, failed: 1, deferred: 0 })
      expect(calls.created).toHaveLength(1)
      expect(calls.marked).toEqual([
        { groupId: 'g1', clientId: 'pending-req-1', outcome: 'failed' },
      ])
    }
  })

  it('defers in-flight CONFLICT replays instead of failing them', async () => {
    const { calls, service } = harness({
      rows: [makeRow()],
      createImpl: async () => {
        throw trpcError(
          'CONFLICT',
          'This create request is still being processed',
        )
      },
    })

    const summary = await runWithClock(service.flush({ namespace: NAMESPACE }))

    // Single attempt, no durable mark: the first attempt may still commit,
    // and the next flush replays to its stored result.
    expect(summary).toEqual({ total: 1, sent: 0, failed: 0, deferred: 1 })
    expect(calls.created).toHaveLength(1)
    expect(calls.marked).toEqual([])
  })

  it('retries transient failures with backoff and sends on recovery', async () => {
    let attempts = 0
    const { calls, service } = harness({
      rows: [makeRow()],
      createImpl: async (input) => {
        attempts += 1
        if (attempts <= 2) throw new TypeError('network down')
        return { expenseId: `real-${input.requestId}`, recurringSeriesId: null }
      },
    })

    const summary = await runWithClock(service.flush({ namespace: NAMESPACE }))

    expect(attempts).toBe(3)
    expect(summary).toEqual({ total: 1, sent: 1, failed: 0, deferred: 0 })
    expect(calls.marked).toEqual([
      { groupId: 'g1', clientId: 'pending-req-1', outcome: 'sent' },
    ])
  })

  it('bounds transient retries per flush and leaves the row pending', async () => {
    let attempts = 0
    const { calls, service } = harness({
      rows: [makeRow()],
      createImpl: async () => {
        attempts += 1
        throw { status: 503 }
      },
    })

    const summary = await runWithClock(service.flush({ namespace: NAMESPACE }))

    // Initial attempt + 3 bounded retries, then deferred (never failed, never
    // looped): the next reconnect tries again.
    expect(attempts).toBe(4)
    expect(summary).toEqual({ total: 1, sent: 0, failed: 0, deferred: 1 })
    expect(calls.marked).toEqual([])
  })

  it('fails the flush when the outbox cannot be listed', async () => {
    const { service } = harness({ listError: new Error('idb gone') })

    const exit = await Effect.runPromiseExit(
      service.flush({ namespace: NAMESPACE }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.findErrorOption(exit.cause)
      expect(Option.isSome(error)).toBe(true)
      if (Option.isSome(error)) {
        expect(error.value).toBeInstanceOf(PendingFlushStorageError)
        expect(error.value.code).toBe('storage-unavailable')
      }
    }
  })

  it('maps quota failures to the quota code', async () => {
    const quota = new DOMException('exceeded', 'QuotaExceededError')
    const { service } = harness({ listError: quota })

    const exit = await Effect.runPromiseExit(
      service.flush({ namespace: NAMESPACE }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.findErrorOption(exit.cause)
      expect(Option.isSome(error)).toBe(true)
      if (Option.isSome(error)) {
        expect(error.value).toBeInstanceOf(PendingFlushStorageError)
        expect(error.value.code).toBe('quota-exceeded')
      }
    }
  })

  it('fails the flush when a resolution cannot be recorded', async () => {
    const { service } = harness({
      rows: [makeRow()],
      markError: new Error('idb gone'),
    })

    const exit = await Effect.runPromiseExit(
      service.flush({ namespace: NAMESPACE }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})
