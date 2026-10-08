import { Cause, Deferred, Effect, Exit, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import type { UploadError as UploadErrorType } from './errors'
import { UploadError } from './errors'
import { makeUploadPipeline, type UploadPipelineDeps } from './uploads'

// Authoring gate (test-audit): this file owns the upload pipeline — stages
// run exactly once with scoped cleanup on every exit, 4xx transfer
// rejections fail typed while unreadable outcomes resolve unknown (never
// retried), and caller aborts interrupt without minting staged tokens.
// Regression: a retried presign would mint orphan URLs; an unrevoked object
// URL would leak per receipt; a cancelled transfer reported done would mint
// a token for bytes never staged. Codec behavior stays owned by upload
// tests; this file owns the Effect pipeline around the injected stages.

function harness(overrides?: Partial<UploadPipelineDeps>) {
  const calls: string[] = []
  const cleanups: string[] = []
  const transferGate = { current: null as null | Deferred.Deferred<void> }
  const service = makeUploadPipeline({
    decode: (file) => {
      calls.push('decode')
      return Promise.resolve({
        file,
        name: 'receipt.jpg',
        contentType: 'image/jpeg',
        cleanup: () => {
          cleanups.push('decode-url')
        },
      })
    },
    presign: () => {
      calls.push('presign')
      return Promise.resolve({
        uploadUrl: 'https://s3.example/put',
        fileUrl: 'https://cdn.example/f',
      })
    },
    transfer: (_input, signal) => {
      calls.push('transfer')
      const gate = transferGate.current
      if (!gate) return Promise.resolve()
      // Signal-aware stub (parity with fetch PUT): abort rejects like the
      // browser fetch would, so cancellation settles the pipeline.
      return new Promise<void>((resolve, reject) => {
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
      })
    },
    finalize: () => {
      calls.push('finalize')
      return Promise.resolve('staged-1')
    },
    ...overrides,
  })
  const file = new Blob(['bytes'], { type: 'image/jpeg' })
  return { service, calls, cleanups, transferGate, file }
}

describe('upload pipeline', () => {
  it('runs every stage once and cleans up scoped URLs', async () => {
    const { service, calls, cleanups, file } = harness()
    const outcome = await Effect.runPromise(
      service.upload({ file, fileName: 'r.jpg' }),
    )
    expect(outcome).toEqual({
      status: 'done',
      url: 'https://cdn.example/f',
      stagedToken: 'staged-1',
    })
    expect(calls).toEqual(['decode', 'presign', 'transfer', 'finalize'])
    expect(cleanups).toEqual(['decode-url'])
  })

  it('fails typed on decode failure without touching later stages', async () => {
    const { service, calls, file } = harness({
      decode: () => Promise.reject(new Error('cannot read dimensions')),
    })
    const outcome = await Effect.runPromise(
      service.upload({ file, fileName: 'r.jpg' }).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(error),
          onSuccess: () => Effect.succeed(null),
        }),
      ),
    )
    expect(outcome).toBeInstanceOf(UploadError)
    expect((outcome as UploadErrorType).stage).toBe('decode')
    expect(calls).toEqual([])
  })

  it('fails typed on definitive 4xx transfer rejection', async () => {
    let transfers = 0
    const { service, calls, file } = harness({
      transfer: () => {
        transfers += 1
        return Promise.reject(
          Object.assign(new Error('forbidden'), { status: 403 }),
        )
      },
    })
    const outcome = await Effect.runPromise(
      service.upload({ file, fileName: 'r.jpg' }).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(error),
          onSuccess: () => Effect.succeed(null),
        }),
      ),
    )
    expect(outcome).toBeInstanceOf(UploadError)
    expect((outcome as UploadErrorType).stage).toBe('transfer')
    expect(transfers).toBe(1)
    expect(calls).toEqual(['decode', 'presign'])
  })

  it('resolves unknown when the transfer outcome is unreadable, without retry', async () => {
    let transfers = 0
    const { service, calls, file } = harness({
      transfer: () => {
        transfers += 1
        return Promise.reject(new TypeError('network down after send'))
      },
    })
    const outcome = await Effect.runPromise(
      service.upload({ file, fileName: 'r.jpg' }),
    )
    expect(outcome).toEqual({
      status: 'unknown',
      reason: 'transfer-unreadable',
      fileUrl: 'https://cdn.example/f',
    })
    expect(transfers).toBe(1)
    expect(calls).toEqual(['decode', 'presign'])
  })

  it('resolves unknown when finalize fails after a stored transfer', async () => {
    const { service, file } = harness({
      finalize: () => Promise.reject(new Error('stage down')),
    })
    const outcome = await Effect.runPromise(
      service.upload({ file, fileName: 'r.jpg' }),
    )
    expect(outcome).toEqual({
      status: 'unknown',
      reason: 'finalize-failed',
      fileUrl: 'https://cdn.example/f',
    })
  })

  it('interrupts on caller abort and still runs scoped cleanup', async () => {
    const { service, cleanups, transferGate, file } = harness()
    transferGate.current = await Effect.runPromise(Deferred.make<void>())
    const controller = new AbortController()
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        service.upload({ file, fileName: 'r.jpg', signal: controller.signal }),
      )
      yield* Effect.sleep(10)
      controller.abort()
      return yield* Fiber.join(fiber)
    })
    const exit = await Effect.runPromiseExit(program)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      // Caller abort propagates as Effect interruption, never as state.
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    }
    expect(cleanups).toEqual(['decode-url'])
  })
})
