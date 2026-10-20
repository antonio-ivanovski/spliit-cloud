import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { E2E_API_URL } from '../../playwright.config'

export const ANON_STORAGE_STATE = './e2e/.auth/anon.json'

export async function submitProfileName(
  page: Page,
  name: string,
): Promise<void> {
  const displayName = page.getByRole('textbox', {
    name: 'Display name',
    exact: true,
  })
  await expect(displayName).toBeVisible()
  await displayName.fill(name)
  await page.getByRole('button', { name: 'Save and continue' }).click()
}

export async function acknowledgeRecoveryLink(page: Page): Promise<void> {
  // Base UI renders the checkbox as button[role=checkbox], which a wrapping
  // <label> does not activate — target the checkbox itself, not its text.
  const confirm = page.getByRole('checkbox', {
    name: 'I copied and safely stored my sign in link.',
  })
  await confirm.click()
  await expect(confirm).toBeChecked()
  await page.getByRole('button', { name: 'Start using Spliit' }).click()
}

/** Dismiss only an eligible, unviewed announcement; absence needs no timeout. */
export async function dismissUpdatesModal(page: Page): Promise<void> {
  const status = await page.request.get(
    `${E2E_API_URL}/trpc/announcements.latestStatus`,
  )
  expect(status.ok(), 'announcement eligibility must be readable').toBe(true)
  const body = (await status.json()) as {
    result: {
      data: { json: { announcementId: string | null; viewed: boolean } }
    }
  }
  const latest = body.result.data.json
  if (!latest.announcementId || latest.viewed) return
  const dismiss = page.getByRole('button', { name: 'Got it' })
  await expect(dismiss).toBeVisible()
  const marked = page.waitForResponse(/markViewed/)
  await dismiss.click()
  const response = await marked
  expect(response.ok(), 'announcement dismissal must persist').toBe(true)
  await expect(dismiss).toBeHidden()
}

/**
 * Sign out through the owning lifecycle, including anonymous-account
 * confirmation.
 */
export async function signOutAccount(
  page: Page,
  anonymous = false,
): Promise<void> {
  await page.getByRole('button', { name: 'Account', exact: true }).click()
  // The signed-out panel can render before async cleanup triggers its document reload.
  const returned = page.waitForEvent('load')
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  if (anonymous) {
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Sign out', exact: true })
      .click()
  }
  await returned
  await expect(
    page.getByRole('button', { name: /^Anonymous(?: Last used)?$/ }),
  ).toBeVisible()
}
