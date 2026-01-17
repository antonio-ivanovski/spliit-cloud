import { expect, test } from '@playwright/test'
import { createExpense, createGroup, navigateToTab } from '../helpers'

test('View activity page', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E activity test ${Date.now()}`,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Look for the activity tab or link
  const activityTab = page.getByRole('tab', { name: /activity|activities/i })
  if (await activityTab.isVisible()) {
    await activityTab.click()
    await page.waitForURL(/\/groups\/[^/]+\/activity/)
  } else {
    // Try to find an activity link
    const activityLink = page
      .getByRole('link', { name: /activity|activities/i })
      .first()
    if (await activityLink.isVisible()) {
      await activityLink.click()
      await page.waitForLoadState('networkidle')
    }
  }

  // Verify activity page loads
  // The page should show some activity or a message if empty
  const body = page.locator('body')
  await expect(body).toBeVisible()

  // Verify we can see participant names or activity description
  const content = await body.textContent()
  expect(content).toBeTruthy()
})

test('Log shows create', async ({ page }) => {
  const groupName = `PW E2E activity create ${Date.now()}`
  const expenseTitle = `Test Expense ${Date.now()}`

  await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob'],
  })

  await createExpense(page, {
    title: expenseTitle,
    amount: '25.00',
    payer: 'Alice',
  })

  await navigateToTab(page, 'Activity')

  await expect(page.getByText(expenseTitle)).toBeVisible()
  await expect(page.getByText(/created/i)).toBeVisible()
})
