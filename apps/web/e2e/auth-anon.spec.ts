import { expect, test } from '@playwright/test'

import {
  acknowledgeRecoveryLink,
  dismissUpdatesModal,
  submitProfileName,
} from './helpers/auth'
import { uniqueId } from './helpers/data'

test.describe('auth @smoke', () => {
  test('guest can sign up and land logged in', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Anonymous' }).click()
    await page.getByRole('button', { name: 'Create anonymous account' }).click()

    // The name policy is enforced before a valid name completes signup.
    await expect(page.locator('#profile-name')).toBeVisible()
    await page.locator('#profile-name').fill('x')
    await page.getByRole('button', { name: 'Save and continue' }).click()
    await expect(
      page.getByText('Name must be at least 2 characters.'),
    ).toBeVisible()

    await submitProfileName(page, uniqueId('Guest'))
    await acknowledgeRecoveryLink(page)

    // Logged-in home shows the groups view, not the signed-out panel.
    await expect(page).toHaveURL(/\/(\?.*)?$/)
    await expect(page.getByRole('button', { name: 'Anonymous' })).toBeHidden()
    // Fresh accounts get the release-notes dialog; clear it so the run ends
    // in a settled state.
    await dismissUpdatesModal(page)
  })
})
