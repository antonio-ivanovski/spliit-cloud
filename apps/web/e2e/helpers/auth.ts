import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const ANON_STORAGE_STATE = './e2e/.auth/anon.json'

export async function submitProfileName(
  page: Page,
  name: string,
): Promise<void> {
  await expect(page.locator('#profile-name')).toBeVisible()
  await page.locator('#profile-name').fill(name)
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

/**
 * Dismiss the release-notes dialog. Fresh accounts see it ~1.5s after the first
 * load outside /auth/*; it is modal (background goes aria-hidden), so every
 * later step would miss. "Got it" persists viewed server-side, so the shared
 * setup account never shows it again to journey specs.
 */
export async function dismissUpdatesModal(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: 'Got it' })
  const marked = page.waitForResponse(/markViewed/)
  await dismiss.click()
  // Fail loudly on persistence errors: the dialog hides optimistically even
  // when markViewed fails, which would poison the shared setup state with an
  // account that keeps showing the modal.
  const response = await marked
  if (!response.ok()) {
    throw new Error(`markViewed failed with status ${response.status()}`)
  }
  await expect(dismiss).toBeHidden()
}
