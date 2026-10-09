import { expect, test } from '@playwright/test'

import { ANON_STORAGE_STATE } from './helpers/auth'
import { uniqueId } from './helpers/data'
import { createGroup } from './helpers/groups'

test.use({ storageState: ANON_STORAGE_STATE })

test.describe('group creation @smoke', () => {
  test('create a group and land on its members page', async ({ page }) => {
    const name = uniqueId('Trip')
    const groupId = await createGroup(page, name)

    await expect(page).toHaveURL(`/groups/${groupId}/members`)
    await expect(page.getByText('Group created.')).toBeVisible()
  })

  test('group name is required', async ({ page }) => {
    await page.goto('/groups/create')
    // Empty submit surfaces a validation error instead of navigating.
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL('/groups/create')
    await expect(
      page
        .locator('form')
        .getByText(/required|at least/i)
        .first(),
    ).toBeVisible()
  })
})
