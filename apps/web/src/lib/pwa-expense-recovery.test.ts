import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearExpenseUpdateSnapshot,
  readExpenseUpdateSnapshot,
  saveExpenseUpdateSnapshot,
  writeUpdateReceipt,
  type ExpenseRecoveryPayload,
} from './pwa-expense-recovery'

const build = vi.hoisted(() => ({ buildId: 'old', version: 'v1' }))
vi.mock('./pwa-build', async (original) => ({
  ...(await original()),
  PWA_BUILD: build,
}))

// This suite owns the persisted recovery contract, including raw values and
// typed dates across builds. Browser tests own worker transport; form tests own
// RHF capture/restoration. Storage is the real public browser storage shape.
const next = { buildId: 'new', version: 'v2' }
const context = { attemptId: 'attempt', build: next }
const url = '/groups/g/expenses/e/edit'
const identity = { key: 'edit:g:e', namespace: 'account:a', restored: null }
function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}
const payload = {
  values: {
    title: 'x',
    amount: '12.',
    conversionRate: Number.NaN,
    paidFor: [
      { participant: 'p1', shares: '25.' },
      { participant: 'p2', shares: 75 },
    ],
    recurrence: {
      frequency: 'MONTHLY',
      interval: 1,
      end: { type: 'DATE', endDate: new Date('2027-01-01') },
    },
  },
  defaults: { title: '' },
  expectedVersion: 3,
  requestId: 'logical-create',
  scope: 'OCCURRENCE',
} as unknown as ExpenseRecoveryPayload

describe('expense update recovery', () => {
  beforeEach(() => {
    build.buildId = 'old'
  })

  it('restores incomplete input and typed dates only for the committed update and matching editor', () => {
    const store = storage()
    saveExpenseUpdateSnapshot(identity, payload, context, store, url)
    expect(
      readExpenseUpdateSnapshot(identity.key, identity.namespace, store, url),
    ).toBeNull()
    writeUpdateReceipt(context, true, store)
    build.buildId = 'new'
    expect(
      readExpenseUpdateSnapshot(identity.key, identity.namespace, store, url),
    ).toEqual(payload)
    expect(
      readExpenseUpdateSnapshot(identity.key, 'account:b', store, url),
    ).toBeNull()
    expect(
      readExpenseUpdateSnapshot('create:g', identity.namespace, store, url),
    ).toBeNull()
    expect(
      readExpenseUpdateSnapshot(
        identity.key,
        identity.namespace,
        store,
        '/other',
      ),
    ).toBeNull()
    clearExpenseUpdateSnapshot(store)
    expect(
      readExpenseUpdateSnapshot(identity.key, identity.namespace, store, url),
    ).toBeNull()
  })

  it('fails the checkpoint when storage does not retain the snapshot', () => {
    const store = storage()
    store.setItem = () => {}
    expect(() =>
      saveExpenseUpdateSnapshot(identity, payload, context, store, url),
    ).toThrow('could not be verified')
  })

  it('does not restore during an ordinary reload of the old build', () => {
    const store = storage()
    saveExpenseUpdateSnapshot(identity, payload, context, store, url)
    writeUpdateReceipt(context, true, store)
    expect(
      readExpenseUpdateSnapshot(identity.key, identity.namespace, store, url),
    ).toBeNull()
    build.buildId = 'another-build'
    expect(
      readExpenseUpdateSnapshot(identity.key, identity.namespace, store, url),
    ).toBeNull()
  })
})
