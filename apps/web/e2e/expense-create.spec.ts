import { expect, test } from '@playwright/test'

import { ANON_STORAGE_STATE } from './helpers/auth'
import { uniqueId } from './helpers/data'
import { createExpense } from './helpers/expenses'
import { createGroup } from './helpers/groups'

test.use({ storageState: ANON_STORAGE_STATE })

test.describe('expense creation @critical', () => {
  test('create an expense and see it in the list', async ({ page }) => {
    const groupId = await createGroup(page, uniqueId('Dinner club'))
    const title = uniqueId('Restaurant')
    await createExpense(page, groupId, title, '25')

    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/expenses`))
    await expect(page.getByText(title).first()).toBeVisible()
  })

  test('expense detail shows title and amount', async ({ page }) => {
    const groupId = await createGroup(page, uniqueId('Groceries'))
    const title = uniqueId('Supermarket')
    await createExpense(page, groupId, title, '42.5')

    await page
      .getByTestId(/expense-item-/)
      .filter({ hasText: title })
      .first()
      .getByRole('link')
      .click()
    await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+/)
    await expect(page.getByText(title).first()).toBeVisible()
    await expect(page.getByText(/42[.,]50/).first()).toBeVisible()
  })
})
