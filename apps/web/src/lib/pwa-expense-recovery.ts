import superjson from 'superjson'
import { z } from 'zod'

import type { ExpenseFormInputValues } from '@/lib/schemas'

import { PWA_BUILD, pwaBuildSchema } from './pwa-build'
import type { PwaCheckpoint } from './pwa-update-blockers'

export const PWA_EXPENSE_RECOVERY_KEY = 'spliit-pwa-expense-recovery'
export const PWA_UPDATE_RECEIPT_KEY = 'spliit-pwa-update-receipt'
export const PWA_RECOVERY_EVENT = 'spliit:pwa-recovery'
export const PWA_RECOVERY_VERSION = 1

export type ExpenseRecoveryUi = {
  dateDraft?: string | null
  timeDraft?: string | null
}

const payloadSchema = z.object({
  // Drafts deliberately accept incomplete raw input, not the submit schema.
  values: z.record(z.string(), z.unknown()),
  defaults: z.record(z.string(), z.unknown()),
  ui: z
    .object({
      dateDraft: z.string().nullable().optional(),
      timeDraft: z.string().nullable().optional(),
    })
    .optional(),
  expectedVersion: z.number().int().positive().optional(),
  requestId: z.string().min(1).optional(),
  scope: z.enum(['OCCURRENCE', 'THIS_AND_FUTURE']).nullable().optional(),
})
const recoverySchema = z.object({
  schemaVersion: z.literal(PWA_RECOVERY_VERSION),
  namespace: z.string(),
  key: z.string(),
  url: z.string(),
  attemptId: z.string(),
  sourceBuildId: z.string(),
  build: pwaBuildSchema,
  createdAt: z.number(),
  payload: payloadSchema,
})
const receiptSchema = z.object({
  sourceBuildId: z.string(),
  build: pwaBuildSchema,
  attemptId: z.string(),
  recovery: z.boolean(),
  createdAt: z.number(),
})

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ExpenseRecoveryPayload = {
  values: ExpenseFormInputValues
  defaults: ExpenseFormInputValues
  ui?: ExpenseRecoveryUi
  expectedVersion?: number
  requestId?: string
  scope?: 'OCCURRENCE' | 'THIS_AND_FUTURE' | null
}
export type ExpenseRecoveryIdentity = {
  key: string
  namespace: string | null
  restored: ExpenseRecoveryPayload | null
}

const currentUrl = () => location.pathname + location.search + location.hash

export function saveExpenseUpdateSnapshot(
  identity: ExpenseRecoveryIdentity,
  payload: ExpenseRecoveryPayload,
  context: PwaCheckpoint,
  storage?: RecoveryStorage,
  url = currentUrl(),
): void {
  storage ??= sessionStorage
  if (!identity.namespace) throw new Error('Expense account is not ready')
  const envelope = {
    schemaVersion: PWA_RECOVERY_VERSION,
    namespace: identity.namespace,
    key: identity.key,
    url,
    attemptId: context.attemptId,
    sourceBuildId: PWA_BUILD.buildId,
    build: context.build,
    createdAt: Date.now(),
    payload,
  }
  const serialized = superjson.stringify(envelope)
  // Validate the serialized form too: unsupported values must fail before reload.
  recoverySchema.parse(superjson.parse(serialized))
  storage.setItem(PWA_EXPENSE_RECOVERY_KEY, serialized)
  if (storage.getItem(PWA_EXPENSE_RECOVERY_KEY) !== serialized)
    throw new Error('Expense checkpoint could not be verified')
}

export function readUpdateReceipt(storage?: RecoveryStorage) {
  try {
    storage ??= sessionStorage
    const result = receiptSchema.safeParse(
      JSON.parse(storage.getItem(PWA_UPDATE_RECEIPT_KEY) ?? 'null'),
    )
    if (!result.success) return null
    const receipt = result.data
    if (
      Date.now() - receipt.createdAt > 10 * 60_000 ||
      receipt.build.buildId !== PWA_BUILD.buildId ||
      receipt.sourceBuildId === PWA_BUILD.buildId
    )
      return null
    return receipt
  } catch {
    return null
  }
}

export function readExpenseUpdateSnapshot(
  key: string,
  namespace: string | null,
  storage?: RecoveryStorage,
  url = currentUrl(),
): ExpenseRecoveryPayload | null {
  try {
    storage ??= sessionStorage
    const receipt = readUpdateReceipt(storage)
    if (!receipt?.recovery) return null
    const result = recoverySchema.safeParse(
      superjson.parse(storage.getItem(PWA_EXPENSE_RECOVERY_KEY) ?? 'null'),
    )
    if (!result.success) return null
    const entry = result.data
    if (
      entry.key !== key ||
      entry.namespace !== namespace ||
      entry.url !== url ||
      entry.attemptId !== receipt.attemptId ||
      entry.sourceBuildId !== receipt.sourceBuildId ||
      entry.build.buildId !== PWA_BUILD.buildId
    )
      return null
    return entry.payload as ExpenseRecoveryPayload
  } catch {
    return null
  }
}

export function writeUpdateReceipt(
  context: PwaCheckpoint,
  recovery: boolean,
  storage: RecoveryStorage,
): void {
  if (!recovery) storage.removeItem(PWA_EXPENSE_RECOVERY_KEY)
  storage.setItem(
    PWA_UPDATE_RECEIPT_KEY,
    JSON.stringify({
      sourceBuildId: PWA_BUILD.buildId,
      build: context.build,
      attemptId: context.attemptId,
      recovery,
      createdAt: Date.now(),
    }),
  )
}

export function clearExpenseUpdateSnapshot(storage?: RecoveryStorage): void {
  try {
    storage ??= sessionStorage
    storage.removeItem(PWA_EXPENSE_RECOVERY_KEY)
    storage.removeItem(PWA_UPDATE_RECEIPT_KEY)
  } catch {
    // An unavailable store never authorizes activation of a dirty editor.
  }
}

export function finishExpenseUpdateRecovery(success: boolean): void {
  if (success) clearExpenseUpdateSnapshot()
  window.dispatchEvent(
    new CustomEvent(PWA_RECOVERY_EVENT, { detail: { success } }),
  )
}
