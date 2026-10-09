import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Create a group through the UI. Returns the groupId from the resulting
 * members-page URL. Caller must already be signed in.
 */
export async function createGroup(page: Page, name: string): Promise<string> {
  await page.goto('/groups/create')
  await page.getByLabel('Group name').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page).toHaveURL(/\/groups\/[^/]+\/members/)
  const match = page.url().match(/\/groups\/([^/]+)\/members/)
  expect(match?.[1]).toBeTruthy()
  return match![1]
}
