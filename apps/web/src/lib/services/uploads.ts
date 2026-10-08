import { Context, Effect, Layer } from 'effect'

import { UploadError } from './errors'

/**
 * Upload pipeline service (Task 7).
 *
 * Scoped decode/convert, presign, cancellable transfer, and metadata finalize
 * extracted from the upload hooks. Components keep presentation and dispatch;
 * this service owns Effect composition:
 *
 * - Stages run in order with scoped cleanup: decode/convert adapters hand back an
 *   optional cleanup (object-URL revocation); the service runs every registered
 *   cleanup in ensuring finalizers on success, failure, AND interruption —
 *   cancelled uploads never leak object URLs.
 * - Presign, transfer, and finalize each run exactly once. No blanket retry of
 *   mutating stages: a transfer whose outcome cannot be read resolves as
 *   explicit unknown (never auto-retried, never reported as done).
 * - Outcome classification: decode/convert failures and definitive 4xx transfer
 *   rejections fail typed UploadError; caller aborts interrupt (never state);
 *   unreadable transfer outcomes resolve unknown. Finalize never runs after
 *   interruption, so a cancelled upload mints no staged token and leaves no
 *   partial effect.
 * - The optional HEIC conversion codec stays behind the injected decode boundary
 *   (dynamic import at the call site, never a startup dependency).
 */

export interface PreparedFile {
  readonly file: Blob
  readonly name: string
  readonly contentType: string
  /** Scoped cleanup (object-URL revocation). Runs exactly once. */
  readonly cleanup?: () => void
}

export interface PresignResult {
  readonly uploadUrl: string
  readonly fileUrl: string
}

export type UploadDone = {
  readonly status: 'done'
  readonly url: string
  readonly stagedToken: string | null
}

export type UploadUnknown = {
  readonly status: 'unknown'
  readonly reason: 'transfer-unreadable' | 'finalize-failed'
  readonly fileUrl: string | null
}

export type UploadOutcome = UploadDone | UploadUnknown

export type UploadFailure = UploadError

export interface UploadInput {
  readonly file: Blob
  readonly fileName: string
  readonly ledgerId?: string
  readonly signal?: AbortSignal
}

export interface UploadPipelineDeps {
  /** Scoped decode (HEIC conversion stays lazy inside). */
  readonly decode?: (file: Blob, signal: AbortSignal) => Promise<PreparedFile>
  /**
   * Presign boundary (tRPC uploads.presign). Exactly-once normalization happens
   * in the caller; rejections here are typed below.
   */
  readonly presign: (
    input: {
      readonly ledgerId: string
      readonly fileName: string
      readonly contentType: string
      readonly fileSize: number
    },
    signal: AbortSignal,
  ) => Promise<PresignResult>
  /** Single PUT to the presigned URL. */
  readonly transfer: (
    input: {
      readonly uploadUrl: string
      readonly body: Blob
      readonly contentType: string
    },
    signal: AbortSignal,
  ) => Promise<void>
  /**
   * Metadata finalize (staging token mint). Skipped when absent: the outcome
   * carries fileUrl and stagedToken stays null.
   */
  readonly finalize?: (
    input: { readonly fileUrl: string; readonly ledgerId: string },
    signal: AbortSignal,
  ) => Promise<string>
}

export interface UploadPipeline {
  /**
   * Run decode -> presign -> transfer -> finalize exactly once. Fails
   * UploadError for decode/presign/definitive transfer rejections; resolves
   * unknown for unreadable outcomes; interrupts on caller abort.
   */
  readonly upload: (
    input: UploadInput,
  ) => Effect.Effect<UploadOutcome, UploadFailure>
}

export const UploadPipeline = Context.Service<UploadPipeline>('UploadPipeline')

function isAbortLike(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError')
  )
}

function transferStatusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

export function makeUploadPipeline(deps: UploadPipelineDeps): UploadPipeline {
  const decode =
    deps.decode ??
    (() =>
      Promise.reject(
        new UploadError({ stage: 'decode', reason: 'decode-unavailable' }),
      ))

  const upload: UploadPipeline['upload'] = (input) =>
    Effect.gen(function* () {
      if (input.signal?.aborted) return yield* Effect.interrupt
      const cleanups: Array<() => void> = []
      const cleanupAll = Effect.sync(() => {
        while (cleanups.length > 0) {
          const cleanup = cleanups.pop()
          try {
            cleanup?.()
          } catch {
            // Cleanup failures never fail the upload outcome.
          }
        }
      })
      // Race the caller signal with fiber interruption. Listener detach
      // joins the same scoped cleanup as object-URL revocation.
      const race = (fiberSignal: AbortSignal): AbortSignal => {
        const caller = input.signal
        if (!caller) return fiberSignal
        const controller = new AbortController()
        const onAbort = () => controller.abort()
        if (caller.aborted || fiberSignal.aborted) {
          controller.abort()
          return controller.signal
        }
        caller.addEventListener('abort', onAbort, { once: true })
        fiberSignal.addEventListener('abort', onAbort, { once: true })
        cleanups.push(() => {
          caller.removeEventListener('abort', onAbort)
          fiberSignal.removeEventListener('abort', onAbort)
        })
        return controller.signal
      }
      const pipeline = Effect.gen(function* () {
        // Decode (scoped): adapters register object-URL revocation here.
        const prepared = yield* Effect.tryPromise({
          try: (signal) => decode(input.file, race(signal)),
          catch: (error: unknown) =>
            error instanceof UploadError
              ? error
              : new UploadError({ stage: 'decode', reason: 'decode-failed' }),
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (result.cleanup) cleanups.push(result.cleanup)
            }),
          ),
        )
        const contentType = prepared.contentType || 'application/octet-stream'
        const fileSize = prepared.file.size
        // Presign: single attempt, no retry of the minting mutation.
        const presigned = yield* Effect.tryPromise({
          try: (signal) =>
            deps.presign(
              {
                ledgerId: input.ledgerId ?? '',
                fileName: prepared.name || input.fileName,
                contentType,
                fileSize,
              },
              race(signal),
            ),
          catch: (error: unknown) => error,
        }).pipe(
          Effect.matchEffect({
            onFailure: (error: unknown) => {
              if (isAbortLike(error)) return Effect.interrupt
              if (error instanceof UploadError) return Effect.fail(error)
              return Effect.fail(
                new UploadError({
                  stage: 'presign',
                  reason: 'presign-failed',
                }),
              )
            },
            onSuccess: (result) => Effect.succeed(result),
          }),
        )
        // Transfer: single PUT. A 4xx is definitive (bad/expired URL);
        // anything else unreadable is explicit unknown, never retried.
        const transferred:
          | { readonly status: 'transferred'; readonly fileUrl: string }
          | UploadUnknown = yield* Effect.matchEffect(
          Effect.tryPromise({
            try: (signal) =>
              deps.transfer(
                {
                  uploadUrl: presigned.uploadUrl,
                  body: prepared.file,
                  contentType,
                },
                race(signal),
              ),
            catch: (error: unknown) => error,
          }),
          {
            onFailure: (error: unknown) => {
              if (isAbortLike(error)) return Effect.interrupt
              const status = transferStatusOf(error)
              if (status !== null && status >= 400 && status < 500) {
                return Effect.fail(
                  new UploadError({
                    stage: 'transfer',
                    reason: 'transfer-rejected:' + String(status),
                  }),
                )
              }
              return Effect.succeed({
                status: 'unknown' as const,
                reason: 'transfer-unreadable' as const,
                fileUrl: presigned.fileUrl,
              })
            },
            onSuccess: () =>
              Effect.succeed({
                status: 'transferred' as const,
                fileUrl: presigned.fileUrl,
              }),
          },
        )
        if (transferred.status === 'unknown') return transferred
        // Finalize never runs after interruption: no staged token on cancel.
        if (!deps.finalize) {
          return {
            status: 'done' as const,
            url: transferred.fileUrl,
            stagedToken: null,
          }
        }
        const staged = yield* Effect.matchEffect(
          Effect.tryPromise({
            try: (signal) =>
              deps.finalize?.(
                {
                  fileUrl: transferred.fileUrl,
                  ledgerId: input.ledgerId ?? '',
                },
                race(signal),
              ) ?? Promise.resolve(null),
            catch: (error: unknown) => error,
          }),
          {
            onFailure: (error: unknown) => {
              if (isAbortLike(error)) return Effect.interrupt
              return Effect.succeed(null)
            },
            onSuccess: (token) => Effect.succeed(token),
          },
        )
        if (staged === null) {
          return {
            status: 'unknown' as const,
            reason: 'finalize-failed' as const,
            fileUrl: transferred.fileUrl,
          }
        }
        return {
          status: 'done' as const,
          url: transferred.fileUrl,
          stagedToken: staged,
        }
      })
      return yield* Effect.ensuring(pipeline, cleanupAll)
    })

  return { upload }
}

export function makeUploadPipelineLive(
  deps: UploadPipelineDeps,
): Layer.Layer<UploadPipeline> {
  return Layer.succeed(UploadPipeline, makeUploadPipeline(deps))
}
