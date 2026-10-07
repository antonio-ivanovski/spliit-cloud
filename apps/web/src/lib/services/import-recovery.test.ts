import { Deferred, Effect, Exit, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  makeDocumentRecovery,
  type DocumentRecoveryDeps,
  type RecoveryDocument,
} from './import-recovery'

// Authoring gate (test-audit): this file owns document recovery — sequential
// per-document staging with partial failures, resume from staged tokens
// without restaging, bounded per-document timeouts, and cancellation that
// keeps completed stagings. Regression: a failed receipt aborting the whole
// batch would strand the rest; restaging completed documents would mint
// duplicate tokens; an uncancellable run would block wizard navigation.
// Presign/transfer payload shapes stay owned by their boundary tests; this
// file owns the Effect orchestration around the injected stages.

function doc(id: string): RecoveryDocument {
  return {
    id,
    file: new Blob(['bytes-' + id], { type: 'image/jpeg' }),
    fileName: id + '.jpg',
    expenseTitle: 'Expense ' + id,
  }
}

function harness(overrides?: Partial<DocumentRecoveryDeps>) {
  const staged: string[] = []
  const service = makeDocumentRecovery({
    presign: () =>
      Promise.resolve({
        uploadUrl: 'https://s3.example/put',
        fileUrl: 'https://cdn.example/f',
      }),
    convert: (file) => Promise.resolve({ file }),
    transfer: () => Promise.resolve(),
    finalize: (_input) => {
      staged.push(_input.documentId)
      return Promise.resolve('token-' + _input.documentId)
    },
    timeoutMs: 1_000,
    ...overrides,
  })
  return { service, staged }
}

describe('document recovery', () => {
  it('stages sequentially and collects partial failures without stopping', async () => {
    const failing = makeDocumentRecovery({
      presign: () => Promise.resolve({ uploadUrl: 'u', fileUrl: 'f' }),
      convert: (file) => Promise.resolve({ file }),
      transfer: () => Promise.reject(new Error('PUT reset by peer')),
      finalize: () => Promise.resolve('token'),
      timeoutMs: 1_000,
    })
    const outcome = await Effect.runPromise(
      failing.recover({ documents: [doc('a'), doc('b')] }),
    )
    expect(outcome.cancelled).toBe(false)
    expect(outcome.staged).toEqual([])
    expect(outcome.failures.map((f) => f.id)).toEqual(['a', 'b'])
    expect(outcome.failures[0]?.message).toBe('PUT reset by peer')
    const snapshot = await Effect.runPromise(failing.snapshot)
    expect(snapshot.done).toBe(true)
    expect(snapshot.failures).toHaveLength(2)
  })

  it('skips already-staged documents without restaging', async () => {
    let presigns = 0
    const { service } = harness({
      presign: () => {
        presigns += 1
        return Promise.resolve({ uploadUrl: 'u', fileUrl: 'f' })
      },
    })
    const outcome = await Effect.runPromise(
      service.recover({
        documents: [doc('a'), doc('b'), doc('c')],
        alreadyStaged: [{ id: 'a', stagedToken: 'token-a' }],
      }),
    )
    expect(presigns).toBe(2)
    expect(outcome.staged.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(outcome.failures).toEqual([])
  })

  it('resumes from successful staging after a failure run', async () => {
    let attempt = 0
    const { service } = harness({
      transfer: () => {
        attempt += 1
        return attempt === 1
          ? Promise.reject(new Error('first attempt down'))
          : Promise.resolve()
      },
    })
    const first = await Effect.runPromise(
      service.recover({ documents: [doc('a'), doc('b')] }),
    )
    expect(first.staged.map((s) => s.id)).toEqual(['b'])
    expect(first.failures.map((f) => f.id)).toEqual(['a'])
    const second = await Effect.runPromise(
      service.recover({
        documents: [doc('a'), doc('b')],
        alreadyStaged: first.staged,
      }),
    )
    expect(second.failures).toEqual([])
    expect(second.staged.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('bounds slow documents and continues with the rest', async () => {
    const { service } = harness({
      transfer: () => new Promise<void>(() => undefined),
      timeoutMs: 20,
    })
    const outcome = await Effect.runPromise(
      service.recover({ documents: [doc('slow')] }),
    )
    expect(outcome.staged).toEqual([])
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0]?.message).toBe('Document staging timed out.')
  })

  it('interrupts on caller abort and keeps completed stagings', async () => {
    const gate = await Effect.runPromise(Deferred.make<void>())
    const { service } = harness({
      transfer: (_input, signal) =>
        new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
          Effect.runPromise(Deferred.await(gate)).then(() => resolve(), reject)
        }),
    })
    const controller = new AbortController()
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        service.recover({ documents: [doc('a')], signal: controller.signal }),
      )
      yield* Effect.sleep(10)
      controller.abort()
      return yield* Fiber.join(fiber)
    })
    const exit = await Effect.runPromiseExit(program)
    expect(Exit.isFailure(exit)).toBe(true)
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.cancelled).toBe(true)
    expect(snapshot.staged).toEqual([])
  })
})
