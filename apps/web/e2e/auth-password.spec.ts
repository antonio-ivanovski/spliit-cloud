import { expect, test } from '@playwright/test'

import { dismissUpdatesModal, submitProfileName } from './helpers/auth'
import { TEST_PASSWORD, uniqueEmail, uniqueId } from './helpers/data'
import { waitForEmailLink } from './maildev'

test.describe('password auth', () => {
  test('sign up with password, verify email, sign in and out', async ({
    page,
  }) => {
    const email = uniqueEmail()
    const name = uniqueId('Password')

    await page.goto('/')
    // Landing defaults to sign-in: switch to account creation first.
    await page.getByRole('button', { name: 'Create an account' }).click()
    await page.getByRole('tab', { name: 'Password' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign up with password' }).click()
    await expect(
      page.getByText('Check your inbox to verify your account.'),
    ).toBeVisible()

    const verifyLink = await waitForEmailLink(email, '/auth/verify-email')
    await page.goto(verifyLink)
    // Verification signs the session in and returns to complete-profile
    // for the display name (email accounts skip the recovery safeguard).
    await submitProfileName(page, name)
    await dismissUpdatesModal(page)
    await expect(page.getByRole('button', { name: 'Anonymous' })).toBeHidden()

    // Sign out, then back in with the password.
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: 'Anonymous' })).toBeVisible()

    await page.getByRole('tab', { name: 'Password' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in with password' }).click()
    await expect(page).toHaveURL(/\/(\?.*)?$/)
    await expect(page.getByRole('button', { name: 'Anonymous' })).toBeHidden()
  })
})
