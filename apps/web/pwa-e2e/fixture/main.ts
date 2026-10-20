import { Effect } from 'effect'

import { PWA_BUILD } from '@/lib/pwa-build'
import {
  finishExpenseUpdateRecovery,
  readExpenseUpdateSnapshot,
  saveExpenseUpdateSnapshot,
} from '@/lib/pwa-expense-recovery'
import {
  markPwaUpdateProtectionInitialized,
  registerPwaUpdateBlocker,
} from '@/lib/pwa-update-blockers'
import type { ExpenseFormInputValues } from '@/lib/schemas'
import { makePwaUpdateService } from '@/lib/services/pwa-updates'

// This tiny editor isolates native worker transport from API/auth setup. The
// full expense form's restoration behavior is covered in ExpenseForm.test.tsx.
const title = document.querySelector<HTMLInputElement>('#title')!
const blocked = document.querySelector<HTMLInputElement>('#blocked')!
const status = document.querySelector<HTMLOutputElement>('#status')!
document.querySelector('#build')!.textContent = PWA_BUILD.buildId
const identity = { key: 'expense', namespace: 'browser-test', restored: null }
const service = makePwaUpdateService()
const renderStatus = () => {
  status.textContent = JSON.stringify(service.bridge.getSnapshot().update)
}
service.bridge.subscribe(renderStatus)
await Effect.runPromise(service.start)
const restored = readExpenseUpdateSnapshot(identity.key, identity.namespace)
if (restored) {
  title.value = restored.values.title
  finishExpenseUpdateRecovery(true)
}
let clearTitle: (() => void) | undefined
function trackTitle() {
  clearTitle?.()
  clearTitle = title.value
    ? registerPwaUpdateBlocker('expense-form-edits', (context) => {
        saveExpenseUpdateSnapshot(
          identity,
          {
            values: { title: title.value } as ExpenseFormInputValues,
            defaults: { title: '' } as ExpenseFormInputValues,
          },
          context,
        )
      })
    : undefined
}
trackTitle()
title.addEventListener('input', trackTitle)
let clearOther: (() => void) | undefined
blocked.addEventListener('change', () => {
  clearOther?.()
  clearOther = blocked.checked
    ? registerPwaUpdateBlocker('other-form')
    : undefined
})
document.querySelector('#update-now')!.addEventListener('click', () => {
  void Effect.runPromise(service.updateNow)
})
markPwaUpdateProtectionInitialized()
renderStatus()

document.documentElement.dataset.ready = 'true'
