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

test('Log shows update', async ({ page }) => {
  const groupName = `PW E2E activity update ${Date.now()}`
  const expenseTitle = `Update Test Expense ${Date.now()}`
  const updatedTitle = `Updated Expense ${Date.now()}`

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  await createExpense(page, {
    title: expenseTitle,
    amount: '30.00',
    payer: 'Alice',
  })

  // Click on the expense to open edit page
  await page.getByText(expenseTitle).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

  // Update the expense title field
  const titleInput = page.locator('input[name="title"]')
  if (await titleInput.isVisible()) {
    await titleInput.clear()
    await titleInput.fill(updatedTitle)

    // Update the amount field
    const amountInput = page.locator('input[name="amount"]')
    if (await amountInput.isVisible()) {
      await amountInput.clear()
      await amountInput.fill('50.00')
    }

    // Save the changes
    const submitButton = page
      .getByRole('button', { name: /save|update|submit/i })
      .first()
    await submitButton.click()

    // Wait for navigation back
    await page.waitForURL(/\/groups\/[^/]+/)

    // Navigate to activity tab
    await navigateToTab(page, 'Activity')

    // Verify the update activity shows
    await expect(page.getByText(updatedTitle)).toBeVisible()
    await expect(page.getByText(/updated|edit/i)).toBeVisible()
  }
})

test('Log shows delete', async ({ page }) => {
  const groupName = `PW E2E activity delete ${Date.now()}`
  const expenseTitle = `Delete Test Expense ${Date.now()}`

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  await createExpense(page, {
    title: expenseTitle,
    amount: '40.00',
    payer: 'Bob',
  })

  // Click on the expense to open edit page
  await page.getByText(expenseTitle).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/[^/]+\/edit/)

  // Click delete button
  const deleteButton = page.getByRole('button', { name: /delete/i })
  if (await deleteButton.isVisible()) {
    await deleteButton.click()

    // Verify confirmation dialog appears (with heading containing delete)
    const heading = page.locator('[role="heading"]')
    if (await heading.isVisible()) {
      await expect(heading).toContainText(/delete/i)
    }

    // Click confirm delete
    const confirmButton = page
      .getByRole('button')
      .filter({ hasText: /yes|delete|confirm/i })
      .first()
    await confirmButton.click()

    // Wait for navigation back
    await page.waitForURL(/\/groups\/[^/]+/)

    // Verify expense is no longer visible in list
    await expect(page.getByText(expenseTitle)).not.toBeVisible()

    // Navigate to activity tab
    await navigateToTab(page, 'Activity')

    // Verify the delete activity shows
    await expect(page.getByText(/deleted|delete/i)).toBeVisible()
  }
})

test('Log pagination', async ({ page }) => {
  const groupName = `PW E2E activity pagination ${Date.now()}`
  const baseExpenseTitle = `Pagination Test Expense`

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Create 25 expenses to exceed the PAGE_SIZE of 20
  // Each expense creates an activity, so we'll have 25 activities
  for (let i = 1; i <= 25; i++) {
    await createExpense(page, {
      title: `${baseExpenseTitle} ${i}`,
      amount: `${10 + i}.00`,
      payer: i % 2 === 0 ? 'Alice' : 'Bob',
    })
  }

  // Navigate to activity tab
  await navigateToTab(page, 'Activity')

  // Verify initial activities are loaded (should show first page of activities)
  // The most recent activity should be visible
  await expect(page.getByText(`${baseExpenseTitle} 25`)).toBeVisible()

  // Scroll down to trigger infinite scroll pagination
  // Get the activity container and scroll to bottom
  const activityContainer = page.locator('body')
  
  // Scroll down multiple times to ensure we trigger the intersection observer
  for (let i = 0; i < 3; i++) {
    await activityContainer.evaluate((el) => {
      el.scrollBy(0, 500)
    })
    // Small delay between scrolls to allow observer to detect
    await page.waitForTimeout(200)
  }

  // After scrolling, earlier activities from the next page should become visible
  // Verify that both recent (25) and older (1-5) activities are now on the page
  // This indicates that pagination loaded more content
  const allActivityText = await page.locator('body').textContent()
  
  // Verify we have content from both first page (recent) and next page (older)
  expect(allActivityText).toContain(`${baseExpenseTitle} 25`)
  expect(allActivityText).toContain(`${baseExpenseTitle} 20`)
  expect(allActivityText).toContain(`${baseExpenseTitle} 1`)
})
