import { expect, test } from '@playwright/test'

import { dismissUpdatesModal, submitProfileName } from './helpers/auth'
import { uniqueEmail, uniqueId } from './helpers/data'
import { waitForEmailLink } from './maildev'

test.describe('magic link auth', () => {
  test('request a link and sign in from the inbox', async ({ page }) => {
    const email = uniqueEmail()
    const name = uniqueId('Magic')

    // Magic link is the default email variant on the landing panel.
    await page.goto('/')
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send sign-in link' }).click()
    await expect(
      page.getByText('Check your inbox for a sign-in link.'),
    ).toBeVisible()

    const loginLink = await waitForEmailLink(email, '/auth/magic-link/verify')
    await page.goto(loginLink)
    // New accounts land on complete-profile for the display name.
    await submitProfileName(page, name)
    await dismissUpdatesModal(page)
    await expect(page.getByRole('button', { name: 'Anonymous' })).toBeHidden()
  })
})
