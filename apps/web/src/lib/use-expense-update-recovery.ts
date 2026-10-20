import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { UseFormReturn } from 'react-hook-form'

import { useOfflineSession } from '@/lib/offline/provider'
import {
  clearExpenseUpdateSnapshot,
  finishExpenseUpdateRecovery,
  readExpenseUpdateSnapshot,
  saveExpenseUpdateSnapshot,
  type ExpenseRecoveryUi,
  type ExpenseRecoveryIdentity,
  type ExpenseRecoveryPayload,
} from '@/lib/pwa-expense-recovery'
import {
  registerPwaUpdateBlocker,
  notifyPwaUpdateBlockersChanged,
} from '@/lib/pwa-update-blockers'
import type { ExpenseFormInputValues } from '@/lib/schemas'

export function useExpenseUpdateRecoveryIdentity(
  key: string,
): ExpenseRecoveryIdentity {
  const { namespace } = useOfflineSession()
  const previousNamespace = useRef(namespace)
  useEffect(() => {
    if (previousNamespace.current && previousNamespace.current !== namespace)
      clearExpenseUpdateSnapshot()
    previousNamespace.current = namespace
  }, [namespace])
  return useMemo(
    () => ({
      key,
      namespace,
      restored:
        typeof window === 'undefined' || !namespace
          ? null
          : readExpenseUpdateSnapshot(key, namespace),
    }),
    [key, namespace],
  )
}

export type ExpenseUpdateRecovery = ExpenseRecoveryIdentity & {
  metadata: Omit<ExpenseRecoveryPayload, 'values' | 'defaults'>
}

function createRecoveryUiStore(initial: ExpenseRecoveryUi = {}) {
  let values = { ...initial }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => values,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (key: keyof ExpenseRecoveryUi, value: string | null) => {
      if (values[key] === value) return
      values = { ...values, [key]: value }
      listeners.forEach((listener) => listener())
      notifyPwaUpdateBlockersChanged()
    },
  }
}
type RecoveryUiStore = ReturnType<typeof createRecoveryUiStore>
export const ExpenseRecoveryUiContext = createContext<RecoveryUiStore | null>(
  null,
)

/** Keep raw date/time text in the checkpoint even before blur commits it to RHF. */
export function useRecoverableExpenseInput(key: keyof ExpenseRecoveryUi) {
  const context = useContext(ExpenseRecoveryUiContext)
  const [local] = useState(() => createRecoveryUiStore())
  const store = context ?? local
  const values = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )
  return [
    values[key] ?? null,
    (next: string | null) => store.set(key, next),
  ] as const
}

/**
 * Ordinary expense editors opt in; import/preview forms keep their hard
 * blocker.
 */
export function useExpenseUpdateCheckpoint(
  form: UseFormReturn<ExpenseFormInputValues>,
  identity: ExpenseUpdateRecovery | undefined,
  dirty: boolean,
  persisted: boolean,
) {
  const restored = identity?.restored
  const uiStore = useMemo<RecoveryUiStore>(
    () => createRecoveryUiStore(restored?.ui),
    [restored],
  )
  useEffect(() => {
    if (!restored) return
    try {
      form.reset(restored.defaults)
      form.reset(
        {
          ...restored.values,
          ...(restored.ui?.dateDraft != null ? { expenseDay: '' } : {}),
          ...(restored.ui?.timeDraft != null ? { expenseTime: '' } : {}),
        },
        { keepDefaultValues: true },
      )
      finishExpenseUpdateRecovery(true)
    } catch {
      finishExpenseUpdateRecovery(false)
    }
  }, [form, restored])

  useEffect(() => {
    if (persisted) clearExpenseUpdateSnapshot()
  }, [persisted])

  useEffect(() => {
    if (persisted) return
    // Read raw RHF values at the handoff boundary too: the last input event
    // can precede React's effect that publishes isDirty.
    const active = () =>
      dirty ||
      Object.values(uiStore.getSnapshot()).some((value) => value != null) ||
      JSON.stringify(form.getValues()) !==
        JSON.stringify(form.formState.defaultValues)
    if (!identity?.namespace)
      return registerPwaUpdateBlocker('expense-form-edits', undefined, active)
    let capture = () => form.getValues()
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: ({ values }) => {
        capture = () => values
      },
    })
    const unregister = registerPwaUpdateBlocker(
      'expense-form-edits',
      (context) => {
        saveExpenseUpdateSnapshot(
          identity,
          {
            ...identity.metadata,
            ui: { ...uiStore.getSnapshot() },
            values: capture(),
            defaults: form.formState.defaultValues as ExpenseFormInputValues,
          },
          context,
        )
      },
      active,
    )
    return () => {
      unsubscribe()
      unregister()
    }
  }, [dirty, form, identity, persisted, uiStore])
  return uiStore
}
