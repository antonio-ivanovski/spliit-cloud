import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Create an expense with default splits through the UI. Amount is typed as
 * displayed (e.g. "25" for $25.00).
 */
export async function createExpense(
  page: Page,
  groupId: string,
  title: string,
  amount: string,
): Promise<void> {
  await page.goto(`/groups/${groupId}/expenses/create`)
  await page.getByPlaceholder('Monday evening restaurant').fill(title)
  // Exact match: looser text also hits hidden "exact amount" controls from
  // the neighbor's currency-conversion work on this form.
  await page.getByLabel('Amount', { exact: true }).fill(amount)
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/expenses(\\?|$)`))
  await expect(
    page
      .getByTestId(/expense-item-/)
      .filter({ hasText: title })
      .first(),
  ).toBeVisible()
}
