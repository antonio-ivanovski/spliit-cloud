import { expect, test as setup } from '@playwright/test'

import {
  ANON_STORAGE_STATE,
  acknowledgeRecoveryLink,
  dismissUpdatesModal,
  submitProfileName,
} from './helpers/auth'
import { uniqueId } from './helpers/data'

/**
 * One anonymous guest account for the whole run. Journey specs reuse this
 * stored session instead of signing up per test: the API caps anonymous
 * creation at 10/hour/IP, so per-test signups rate-limit the suite into
 * failure. The email-method states are not needed — those specs drive their own
 * single signup each.
 */
setup('create anonymous guest state', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Anonymous' }).click()
  await page.getByRole('button', { name: 'Create anonymous account' }).click()

  await submitProfileName(page, uniqueId('Guest'))
  await acknowledgeRecoveryLink(page)

  await expect(page).toHaveURL(/\/(\?.*)?$/)
  await expect(page.getByRole('button', { name: 'Anonymous' })).toBeHidden()
  // Persist "viewed" for this account so journey specs never see the modal.
  await dismissUpdatesModal(page)
  // Prove persistence before snapshotting the shared state: reload, then read
  // the latestStatus body itself. `viewed:true` means the modal effect can
  // never arm its timer; anything else fails loudly here (and the trailing
  // hidden assertion fails once the dialog opens) instead of silently
  // poisoning every journey spec ~1.5s after their first navigation.
  const statusResponse = page.waitForResponse(/latestStatus/)
  await page.reload()
  const status = await statusResponse
  if (!status.ok()) {
    throw new Error(`latestStatus failed with status ${status.status()}`)
  }
  const statusBody = await status.text()
  if (!statusBody.includes('"viewed":true')) {
    throw new Error(
      `announcement view did not persist: ${statusBody.slice(0, 200)}`,
    )
  }
  await expect(page.getByRole('button', { name: 'Got it' })).toBeHidden()
  await page.context().storageState({ path: ANON_STORAGE_STATE })
})
