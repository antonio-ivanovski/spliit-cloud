import { expect, test } from '@playwright/test'

import { ANON_STORAGE_STATE } from './helpers/auth'
import { uniqueId } from './helpers/data'
import { createExpense } from './helpers/expenses'
import { createGroup } from './helpers/groups'

test.use({ storageState: ANON_STORAGE_STATE })

test.describe('group views @smoke', () => {
  test('expenses, members and activity pages render', async ({ page }) => {
    const name = uniqueId('Views group')
    const groupId = await createGroup(page, name)
    await createExpense(page, groupId, uniqueId('Lunch'), '15')

    await page.goto(`/groups/${groupId}/members`)
    // The page heading: body copy can contain hidden responsive duplicates of
    // the group name (e.g. the header link), which a bare getByText trips on.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name)

    await page.goto(`/groups/${groupId}/activity`)
    await expect(page).toHaveURL(`/groups/${groupId}/activity`)
  })

  test('recent groups list shows the new group on home', async ({ page }) => {
    const name = uniqueId('Home group')
    await createGroup(page, name)

    await page.goto('/')
    await expect(page.getByText(name).first()).toBeVisible()
  })
})
