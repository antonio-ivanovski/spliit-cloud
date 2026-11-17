import { useSyncExternalStore } from 'react'

export type ExpenseFormDensity = 'compact' | 'expanded'
const key = 'spliit-expense-form-density'
const changeEvent = 'spliit-expense-form-density-change'

function readDensity(): ExpenseFormDensity {
  try {
    return localStorage.getItem(key) === 'expanded' ? 'expanded' : 'compact'
  } catch {
    return 'compact'
  }
}

export function writeExpenseFormDensity(value: ExpenseFormDensity) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable in private browsing.
  }
  window.dispatchEvent(new Event(changeEvent))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener()
  }
  window.addEventListener(changeEvent, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(changeEvent, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useExpenseFormDensity() {
  return useSyncExternalStore(subscribe, readDensity, () => 'compact' as const)
}
