import { expect, test } from '@playwright/test'

import { ANON_STORAGE_STATE } from './helpers/auth'
import { uniqueId } from './helpers/data'
import { createExpense } from './helpers/expenses'
import { createGroup } from './helpers/groups'

test.use({ storageState: ANON_STORAGE_STATE })

/**
 * Personal happy paths: fast entry, a budget, and the group-expense link. These
 * are intentionally shallow smoke tests; the detailed math is covered by
 * domain/API tests.
 */
test.describe('personal expenses @smoke', () => {
  test('add a personal expense and see it in the ledger', async ({ page }) => {
    await page.goto('/personal')
    await page.getByRole('button', { name: 'Add expense' }).first().click()

    const dialog = page.getByRole('dialog')
    const title = uniqueId('Lunch')
    await dialog.getByLabel('Amount', { exact: true }).fill('25')
    await dialog.getByLabel('Title (optional)').fill(title)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()

    await expect(page.getByText('Entry added')).toBeVisible()

    await page.getByRole('link', { name: 'Transactions', exact: true }).click()
    await expect(page).toHaveURL(/\/personal\/transactions/)
    await expect(page.getByText(title).first()).toBeVisible()
    await expect(page.getByText(/25[.,]00/).first()).toBeVisible()
  })

  test('create a budget and see the remaining amount update', async ({
    page,
  }) => {
    await page.goto('/personal/budgets')
    await page.getByRole('button', { name: 'New budget' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name').fill('Groceries')
    await dialog.getByLabel('Amount').fill('100')
    await dialog.getByRole('button', { name: 'Save budget' }).click()
    await expect(page.getByText('Budget saved')).toBeVisible()

    await page.goto('/personal')
    await page.getByRole('button', { name: 'Add expense' }).first().click()
    const quickAdd = page.getByRole('dialog')
    await quickAdd.getByLabel('Amount', { exact: true }).fill('30')
    await quickAdd
      .getByLabel('Title (optional)')
      .fill(uniqueId('Budget groceries'))
    await quickAdd.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Entry added')).toBeVisible()

    await page.goto('/personal/budgets')
    await expect(page.getByText('Groceries').first()).toBeVisible()
    await expect(page.getByText(/\$100[.,]00/).first()).toBeVisible()
    await expect(page.getByText(/left|over/).first()).toBeVisible()
  })

  test('import a bank CSV into Personal', async ({ page }) => {
    await page.goto('/personal/transactions/import')
    const coffee = uniqueId('Coffee')
    const salary = uniqueId('Salary')
    const csv = [
      'date,description,amount',
      `2026-10-24,${coffee},-4.50`,
      `2026-10-23,${salary},2500.00`,
    ].join('\n')
    await page.locator('input[type=file]').setInputFiles({
      name: 'bank.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    })

    await expect(page.getByText('Mapping')).toBeVisible()
    await page.getByRole('button', { name: 'Review' }).click()
    await expect(
      page.getByRole('button', { name: 'Import selected' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Import selected' }).click()

    await expect(page.getByText('Import complete')).toBeVisible()
    await expect(page.getByText(/Imported 2 transactions/)).toBeVisible()
    await page.getByRole('button', { name: 'Back to transactions' }).click()
    await expect(page.getByText(coffee).first()).toBeVisible()
    await expect(page.getByText(/2,500[.,]00/).first()).toBeVisible()
  })

  test('include a group expense in Personal', async ({ page }) => {
    const groupName = uniqueId('Personal flat')
    const groupId = await createGroup(page, groupName)
    const expenseTitle = uniqueId('Shared dinner')
    await createExpense(page, groupId, expenseTitle, '48')

    await page.goto('/personal/settings')
    await page
      .getByRole('switch', { name: /Include my share of group/ })
      .click()
    await expect(page.getByText('Settings saved')).toBeVisible()

    const groupRow = page
      .getByRole('listitem')
      .filter({ hasText: groupName })
      .first()
    await expect(groupRow).toBeVisible()
    await groupRow
      .getByRole('checkbox', { name: `Include ${groupName} in Personal` })
      .click()
    const saved = page.waitForResponse((response) =>
      response.url().includes('personal.sources.updateRule'),
    )
    await groupRow.getByRole('button', { name: 'Save' }).click()
    const savedResponse = await saved
    expect(savedResponse.ok(), await savedResponse.text()).toBe(true)

    await page.reload()
    await expect(
      page.getByRole('checkbox', {
        name: `Include ${groupName} in Personal`,
      }),
    ).toBeChecked()

    await page.goto('/personal/transactions')
    const entry = page
      .getByRole('listitem')
      .filter({ hasText: expenseTitle })
      .first()
    await expect(entry).toBeVisible()
    await expect(entry.getByText('Shared', { exact: true })).toBeVisible()
  })

  test('open the personal categorize flow without AI cost', async ({
    page,
  }) => {
    // Local/dictionary mode only: no System One, no provider calls. The page
    // shows either the empty state or the local-mode chooser.
    await page.goto('/personal/transactions/categorize')
    await expect(
      page.getByRole('heading', { name: 'Review & categorize' }),
    ).toBeVisible()
    const empty = page.getByText(
      'All personal expenses already have a category.',
    )
    const chooser = page.getByRole('button', { name: 'Start categorizing' })
    await expect(empty.or(chooser)).toBeVisible()
  })

  test('plan a monthly expense and see it in Upcoming but not Transactions', async ({
    page,
  }) => {
    // No worker runs in E2E, so nothing materializes: the plan stays in
    // Upcoming/Planned and out of Transactions until the worker reconciles.
    await page.goto('/personal/recurring')
    await page
      .getByRole('button', { name: 'New planned transaction' })
      .first()
      .click()

    const dialog = page.getByRole('dialog')
    const title = uniqueId('Planned rent')
    await dialog.getByLabel('Amount', { exact: true }).fill('50')
    await dialog.getByLabel(/title/i).fill(title)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Planned transaction created')).toBeVisible()

    await expect(page.getByText(title).first()).toBeVisible()

    await page.goto('/personal/transactions')
    await expect(
      page.getByRole('listitem').filter({ hasText: title }),
    ).toHaveCount(0)

    // Pause the plan again from the Planned page.
    await page.goto('/personal/recurring')
    const card = page
      .getByText(title)
      .locator('xpath=ancestor::div[contains(@class,"space-y-2")][1]')
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(page.getByText('Plan paused')).toBeVisible()
    await expect(page.getByText('Paused').first()).toBeVisible()
  })
})
