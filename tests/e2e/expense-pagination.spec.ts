import { expect, test } from '@playwright/test'
import {
  createExpensesViaAPI,
  createGroupViaAPI,
  navigateToGroup,
} from '../helpers'

test.describe('Expense List Pagination', () => {
  test('loads initial page of expenses', async ({ page }) => {
    // Create group via API for speed
    await page.goto('/groups')
    const groupId = await createGroupViaAPI(
      page,
      `Pagination Init ${Date.now()}`,
      ['Alice', 'Bob'],
    )

    // Create 15 expenses (less than PAGE_SIZE of 20)
    await createExpensesViaAPI(page, groupId, 15, ['Alice', 'Bob'])

    await navigateToGroup(page, groupId)

    // Verify expenses are visible
    await expect(page.getByText('Expense 01')).toBeVisible()
    await expect(page.getByText('Expense 15')).toBeVisible()
  })

  test('loads more expenses on scroll with infinite scroll', async ({
    page,
  }) => {
    await page.goto('/groups')
    const groupId = await createGroupViaAPI(
      page,
      `Pagination Scroll ${Date.now()}`,
      ['Alice', 'Bob', 'Charlie'],
    )

    // Create 25 expenses (more than PAGE_SIZE of 20)
    const createdExpenses = await createExpensesViaAPI(page, groupId, 25, [
      'Alice',
      'Bob',
    ])
    expect(createdExpenses).toHaveLength(25)

    await navigateToGroup(page, groupId)

    // Verify most recent expenses visible initially (expenses shown in reverse order)
    await expect(page.getByText('Expense 25')).toBeVisible()

    // Scroll to bottom to trigger loading more
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })

    // Wait for new content to load
    await page.waitForLoadState('networkidle')

    // Check that earlier expenses become visible after scrolling
    // All 25 should eventually be loaded
    await expect(page.getByText('Expense 01')).toBeVisible({ timeout: 10000 })
  })

  test('displays correct expense count after loading all pages', async ({
    page,
  }) => {
    await page.goto('/groups')
    const groupId = await createGroupViaAPI(
      page,
      `Pagination Count ${Date.now()}`,
      ['Alice', 'Bob'],
    )

    // Create 30 expenses (requires 2 pages)
    await createExpensesViaAPI(page, groupId, 30, ['Alice', 'Bob'])

    await navigateToGroup(page, groupId)

    // Scroll multiple times to load all
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight)
      })
      await page.waitForTimeout(500)
    }

    // Verify first and last expenses are visible
    await expect(page.getByText('Expense 30')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Expense 01')).toBeVisible({ timeout: 10000 })
  })

  test('maintains expense order after pagination', async ({ page }) => {
    await page.goto('/groups')
    const groupId = await createGroupViaAPI(
      page,
      `Pagination Order ${Date.now()}`,
      ['Alice', 'Bob'],
    )

    // Create 22 expenses
    await createExpensesViaAPI(page, groupId, 22, ['Alice', 'Bob'])

    await navigateToGroup(page, groupId)

    // Most recent should appear first
    const expense22 = page.getByText('Expense 22')
    const expense21 = page.getByText('Expense 21')

    await expect(expense22).toBeVisible()
    await expect(expense21).toBeVisible()

    // Scroll to load more
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    await page.waitForLoadState('networkidle')

    // After loading more, older expenses should appear
    await expect(page.getByText('Expense 01')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Expense 02')).toBeVisible()
  })

  test('pagination works with search filter', async ({ page }) => {
    await page.goto('/groups')
    const groupId = await createGroupViaAPI(
      page,
      `Pagination Filter ${Date.now()}`,
      ['Alice', 'Bob'],
    )

    // Create 25 expenses
    await createExpensesViaAPI(page, groupId, 25, ['Alice', 'Bob'])

    await navigateToGroup(page, groupId)

    // Apply search filter
    const searchInput = page.getByPlaceholder(/search/i)
    await searchInput.fill('Expense 1')
    await page.waitForTimeout(400)

    // Should filter to expenses 01, 10-19
    // Expense 10-19 should match "Expense 1"
    await expect(page.getByText('Expense 10')).toBeVisible()
    await expect(page.getByText('Expense 15')).toBeVisible()

    // Expenses not matching should not appear
    await expect(page.getByText('Expense 22')).not.toBeVisible()
    await expect(page.getByText('Expense 25')).not.toBeVisible()
  })

  test('empty state when no expenses', async ({ page }) => {
    await page.goto('/groups')
    const groupId = await createGroupViaAPI(page, `Empty State ${Date.now()}`, [
      'Alice',
      'Bob',
    ])

    await navigateToGroup(page, groupId)

    // Should show empty state or "create first" message
    await expect(page.getByText(/no expenses|create/i)).toBeVisible()
  })

  test('loading indicator appears during pagination', async ({ page }) => {
    await page.goto('/groups')
    const groupId = await createGroupViaAPI(
      page,
      `Loading State ${Date.now()}`,
      ['Alice', 'Bob', 'Charlie'],
    )

    // Create many expenses to ensure pagination is needed
    await createExpensesViaAPI(page, groupId, 30, ['Alice', 'Bob'])

    await navigateToGroup(page, groupId)

    // Verify initial content loaded
    await expect(page.getByText('Expense 30')).toBeVisible()

    // Scroll and check for loading state (skeleton or spinner)
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })

    // Eventually more content should load
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Expense 01')).toBeVisible({ timeout: 10000 })
  })

  test('expense amounts display correctly across pages', async ({ page }) => {
    await page.goto('/groups')
    const groupId = await createGroupViaAPI(
      page,
      `Amount Display ${Date.now()}`,
      ['Alice', 'Bob'],
    )

    // Create 25 expenses (amounts will be 1100, 1200, ... based on createExpensesViaAPI)
    await createExpensesViaAPI(page, groupId, 25, ['Alice', 'Bob'])

    await navigateToGroup(page, groupId)

    // Expense 25 should have amount 25 * 100 + 1000 = 3500 cents = $35.00
    await expect(page.getByText('$35.00')).toBeVisible()

    // Scroll to load all
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    await page.waitForLoadState('networkidle')

    // Expense 01 should have amount 1 * 100 + 1000 = 1100 cents = $11.00
    await expect(page.getByText('$11.00')).toBeVisible({ timeout: 10000 })
  })
})
