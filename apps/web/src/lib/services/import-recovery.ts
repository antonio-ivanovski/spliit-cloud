import { Cause, Context, Effect, Exit, Layer, Option } from 'effect'

import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

/**
 * Import document recovery service (Task 7).
 *
 * Sequential per-document staging extracted from the import documents step. The
 * step keeps presentation, file selection, and dispatch; this service owns
 * Effect composition:
 *
 * - Sequential per-document staging: presign -> convert -> transfer -> finalize,
 *   one document at a time, with a bounded per-document timeout (60s parity). A
 *   failed document records a partial failure and the run continues with the
 *   next — one bad receipt never blocks the rest.
 * - Resume from successful staging: already-staged ids are never restaged; a
 *   retry after cancel/failure stages only the remainder.
 * - Cancel is caller interruption (step unmount / Cancel button): in-flight work
 *   settles between documents, completed stagings stand, and the outcome
 *   reports cancelled:true with the partial results.
 * - Progress is observable through the snapshot bridge (staged count, current id,
 *   failures); the step renders from it.
 *
 * Failure messages pass through Error.message (parity with the current failure
 * list UI); no new user-facing copy is added.
 */

export const DOCUMENT_STAGING_TIMEOUT_MS = 60_000

export interface RecoveryDocument {
  readonly id: string
  readonly file: Blob
  readonly fileName: string
  readonly expenseTitle: string
}

export interface StagedDocument {
  readonly id: string
  readonly stagedToken: string
}

export interface RecoveryFailure {
  readonly id: string
  readonly expenseTitle: string
  readonly message: string
}

export interface RecoverySnapshot {
  readonly total: number
  readonly staged: StagedDocument[]
  readonly failures: RecoveryFailure[]
  readonly currentId: string | null
  readonly done: boolean
  readonly cancelled: boolean
}

export const INITIAL_RECOVERY: RecoverySnapshot = {
  total: 0,
  staged: [],
  failures: [],
  currentId: null,
  done: false,
  cancelled: false,
}

export interface RecoveryOutcome {
  readonly staged: StagedDocument[]
  readonly failures: RecoveryFailure[]
  readonly cancelled: boolean
}

export interface DocumentRecoveryDeps {
  readonly presign: (
    input: {
      readonly fileName: string
      readonly contentType: string
      readonly fileSize: number
    },
    signal: AbortSignal,
  ) => Promise<{ readonly uploadUrl: string; readonly fileUrl: string }>
  readonly convert: (
    file: Blob,
    signal: AbortSignal,
  ) => Promise<{ readonly file: Blob; readonly cleanup?: () => void }>
  readonly transfer: (
    input: {
      readonly uploadUrl: string
      readonly body: Blob
      readonly contentType: string
    },
    signal: AbortSignal,
  ) => Promise<void>
  readonly finalize: (
    input: { readonly fileUrl: string; readonly documentId: string },
    signal: AbortSignal,
  ) => Promise<string>
  readonly timeoutMs?: number
}

export interface DocumentRecovery {
  readonly bridge: SnapshotBridge<RecoverySnapshot>
  readonly snapshot: Effect.Effect<RecoverySnapshot>
  /**
   * Stage every document sequentially, skipping already-staged ids. Partial
   * failures are collected; caller abort interrupts with the partial results
   * reported as cancelled:true.
   */
  readonly recover: (input: {
    readonly documents: RecoveryDocument[]
    readonly alreadyStaged?: StagedDocument[]
    readonly signal?: AbortSignal
  }) => Effect.Effect<RecoveryOutcome>
}

export const DocumentRecovery =
  Context.Service<DocumentRecovery>('DocumentRecovery')

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

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

export function makeDocumentRecovery(
  deps: DocumentRecoveryDeps,
): DocumentRecovery {
  const timeoutMs = deps.timeoutMs ?? DOCUMENT_STAGING_TIMEOUT_MS
  const bridge = createSnapshotBridge(INITIAL_RECOVERY)

  const recover: DocumentRecovery['recover'] = (input) =>
    Effect.gen(function* () {
      if (input.signal?.aborted) return yield* Effect.interrupt
      const detaches: Array<() => void> = []
      const detachAll = Effect.sync(() => {
        while (detaches.length > 0) {
          try {
            detaches.pop()?.()
          } catch {
            // Listener teardown never fails recovery reporting.
          }
        }
      })
      const linked = (fiberSignal: AbortSignal): AbortSignal =>
        linkSignal(input.signal, fiberSignal, (detach) => {
          detaches.push(detach)
        })
      return yield* Effect.ensuring(recoverBody(input, linked), detachAll)
    })

  const recoverBody = (
    input: {
      readonly documents: RecoveryDocument[]
      readonly alreadyStaged?: StagedDocument[]
      readonly signal?: AbortSignal
    },
    linked: (fiberSignal: AbortSignal) => AbortSignal,
  ): Effect.Effect<RecoveryOutcome> =>
    Effect.gen(function* () {
      const stagedIds = new Set(
        (input.alreadyStaged ?? []).map((entry) => entry.id),
      )
      const todo = input.documents.filter((doc) => !stagedIds.has(doc.id))
      const staged: StagedDocument[] = [...(input.alreadyStaged ?? [])]
      const failures: RecoveryFailure[] = []
      bridge.publish({
        total: todo.length,
        staged: [...staged],
        failures: [],
        currentId: null,
        done: false,
        cancelled: false,
      })

      for (const doc of todo) {
        if (input.signal?.aborted) {
          bridge.publish({
            total: todo.length,
            staged: [...staged],
            failures: [...failures],
            currentId: null,
            done: false,
            cancelled: true,
          })
          return yield* Effect.interrupt
        }
        const current = bridge.getSnapshot()
        bridge.publish({ ...current, currentId: doc.id })
        // Per-document bound: expiry records a partial failure and the run
        // continues with the next document (parity with the step UI).
        const attempt = Effect.tryPromise({
          try: async (signal: AbortSignal) => {
            const signalForDoc = linked(signal)
            const contentType = doc.file.type || 'application/octet-stream'
            const presigned = await deps.presign(
              { fileName: doc.fileName, contentType, fileSize: doc.file.size },
              signalForDoc,
            )
            const converted = await deps.convert(doc.file, signalForDoc)
            try {
              await deps.transfer(
                {
                  uploadUrl: presigned.uploadUrl,
                  body: converted.file,
                  contentType,
                },
                signalForDoc,
              )
              const token = await deps.finalize(
                { fileUrl: presigned.fileUrl, documentId: doc.id },
                signalForDoc,
              )
              return token
            } finally {
              try {
                converted.cleanup?.()
              } catch {
                // Cleanup failures never fail staging.
              }
            }
          },
          catch: (error: unknown) => error,
        })
        const bounded = Effect.timeoutOption(attempt, timeoutMs).pipe(
          Effect.flatMap((option) =>
            option._tag === 'Some'
              ? Effect.succeed(option.value)
              : Effect.fail(new Error('Document staging timed out.')),
          ),
        )
        const outcome = yield* Effect.exit(bounded)
        if (Exit.isSuccess(outcome)) {
          staged.push({ id: doc.id, stagedToken: outcome.value })
        } else {
          // tryPromise rejections land in the failure channel exactly once:
          // read the typed error back out (never raw causes or payloads).
          const found = Cause.findErrorOption<unknown>(outcome.cause)
          const error = Option.isSome(found) ? found.value : outcome.cause
          if (isAbortLike(error) || input.signal?.aborted) {
            bridge.publish({
              total: todo.length,
              staged: [...staged],
              failures: [...failures],
              currentId: null,
              done: false,
              cancelled: true,
            })
            return yield* Effect.interrupt
          }
          failures.push({
            id: doc.id,
            expenseTitle: doc.expenseTitle,
            message: messageOf(error, 'Document staging failed.'),
          })
        }
        bridge.publish({
          total: todo.length,
          staged: [...staged],
          failures: [...failures],
          currentId: null,
          done: false,
          cancelled: false,
        })
      }

      bridge.publish({
        total: todo.length,
        staged: [...staged],
        failures: [...failures],
        currentId: null,
        done: true,
        cancelled: false,
      })
      return { staged, failures, cancelled: false }
    })

  return { bridge, snapshot: bridge.readEffect, recover }
}

function linkSignal(
  caller: AbortSignal | undefined,
  fiberSignal: AbortSignal,
  onDetach: (detach: () => void) => void,
): AbortSignal {
  if (!caller) return fiberSignal
  if (caller.aborted || fiberSignal.aborted) {
    const aborted = new AbortController()
    aborted.abort()
    return aborted.signal
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  caller.addEventListener('abort', onAbort, { once: true })
  fiberSignal.addEventListener('abort', onAbort, { once: true })
  onDetach(() => {
    caller.removeEventListener('abort', onAbort)
    fiberSignal.removeEventListener('abort', onAbort)
  })
  return controller.signal
}

export function makeDocumentRecoveryLive(
  deps: DocumentRecoveryDeps,
): Layer.Layer<DocumentRecovery> {
  return Layer.succeed(DocumentRecovery, makeDocumentRecovery(deps))
}
