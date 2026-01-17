import { expect, test } from '@playwright/test'
import { createExpense, createGroup, navigateToGroup } from '../helpers'

test.describe('Expense List Filtering', () => {
  test('filters expenses by text search', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Filter Test ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    // Create expenses with distinct names
    await createExpense(page, {
      title: 'Pizza Dinner',
      amount: '50.00',
      payer: 'Alice',
    })

    await createExpense(page, {
      title: 'Movie Tickets',
      amount: '30.00',
      payer: 'Bob',
    })

    await createExpense(page, {
      title: 'Grocery Shopping',
      amount: '75.00',
      payer: 'Alice',
    })

    // Verify all expenses visible initially
    await expect(page.getByText('Pizza Dinner')).toBeVisible()
    await expect(page.getByText('Movie Tickets')).toBeVisible()
    await expect(page.getByText('Grocery Shopping')).toBeVisible()

    // Search for "Pizza"
    const searchInput = page.getByPlaceholder(/search/i)
    await searchInput.fill('Pizza')

    // Wait for debounce
    await page.waitForTimeout(400)

    // Verify only Pizza visible
    await expect(page.getByText('Pizza Dinner')).toBeVisible()
    await expect(page.getByText('Movie Tickets')).not.toBeVisible()
    await expect(page.getByText('Grocery Shopping')).not.toBeVisible()

    // Clear search and verify all return
    await searchInput.clear()
    await page.waitForTimeout(400)

    await expect(page.getByText('Pizza Dinner')).toBeVisible()
    await expect(page.getByText('Movie Tickets')).toBeVisible()
    await expect(page.getByText('Grocery Shopping')).toBeVisible()
  })

  test('case insensitive search', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Case Test ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    await createExpense(page, {
      title: 'UPPERCASE EXPENSE',
      amount: '40.00',
      payer: 'Alice',
    })

    await createExpense(page, {
      title: 'lowercase expense',
      amount: '60.00',
      payer: 'Bob',
    })

    // Search lowercase for uppercase title
    const searchInput = page.getByPlaceholder(/search/i)
    await searchInput.fill('uppercase')
    await page.waitForTimeout(400)

    await expect(page.getByText('UPPERCASE EXPENSE')).toBeVisible()
    await expect(page.getByText('lowercase expense')).not.toBeVisible()

    // Search uppercase for lowercase title
    await searchInput.clear()
    await searchInput.fill('LOWERCASE')
    await page.waitForTimeout(400)

    await expect(page.getByText('UPPERCASE EXPENSE')).not.toBeVisible()
    await expect(page.getByText('lowercase expense')).toBeVisible()
  })

  test('partial text match', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Partial Test ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    await createExpense(page, {
      title: 'Restaurant Dinner',
      amount: '85.00',
      payer: 'Alice',
    })

    await createExpense(page, {
      title: 'Breakfast at Cafe',
      amount: '25.00',
      payer: 'Bob',
    })

    // Search for partial match "fast"
    const searchInput = page.getByPlaceholder(/search/i)
    await searchInput.fill('fast')
    await page.waitForTimeout(400)

    // Should match "Breakfast"
    await expect(page.getByText('Restaurant Dinner')).not.toBeVisible()
    await expect(page.getByText('Breakfast at Cafe')).toBeVisible()
  })

  test('no results found', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `No Results ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    await createExpense(page, {
      title: 'Regular Expense',
      amount: '50.00',
      payer: 'Alice',
    })

    // Search for non-existent text
    const searchInput = page.getByPlaceholder(/search/i)
    await searchInput.fill('xyz123nonexistent')
    await page.waitForTimeout(400)

    // Expense should not be visible
    await expect(page.getByText('Regular Expense')).not.toBeVisible()

    // There should be some "no expenses" indication or empty state
    // Clear search to verify expense returns
    await searchInput.clear()
    await page.waitForTimeout(400)

    await expect(page.getByText('Regular Expense')).toBeVisible()
  })

  test('filter with multiple matching expenses', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Multi Match ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    await navigateToGroup(page, groupId)

    // Create expenses with common term "Dinner"
    await createExpense(page, {
      title: 'Dinner at Italian Restaurant',
      amount: '80.00',
      payer: 'Alice',
    })

    await createExpense(page, {
      title: 'Dinner at Chinese Restaurant',
      amount: '65.00',
      payer: 'Bob',
    })

    await createExpense(page, {
      title: 'Lunch Break',
      amount: '25.00',
      payer: 'Charlie',
    })

    // Search for "Dinner"
    const searchInput = page.getByPlaceholder(/search/i)
    await searchInput.fill('Dinner')
    await page.waitForTimeout(400)

    // Both dinner expenses visible
    await expect(page.getByText('Dinner at Italian Restaurant')).toBeVisible()
    await expect(page.getByText('Dinner at Chinese Restaurant')).toBeVisible()
    await expect(page.getByText('Lunch Break')).not.toBeVisible()

    // Verify amounts of visible expenses
    await expect(page.getByText('$80.00')).toBeVisible()
    await expect(page.getByText('$65.00')).toBeVisible()
    await expect(page.getByText('$25.00')).not.toBeVisible()
  })

  test('clear search with x button', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Clear Button ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    await createExpense(page, {
      title: 'Test Expense One',
      amount: '100.00',
      payer: 'Alice',
    })

    await createExpense(page, {
      title: 'Test Expense Two',
      amount: '200.00',
      payer: 'Bob',
    })

    // Filter to show only one
    const searchInput = page.getByPlaceholder(/search/i)
    await searchInput.fill('One')
    await page.waitForTimeout(400)

    await expect(page.getByText('Test Expense One')).toBeVisible()
    await expect(page.getByText('Test Expense Two')).not.toBeVisible()

    // Try to clear with X button if it exists
    const clearButton = page.locator('svg.lucide-x-circle')
    if (await clearButton.isVisible()) {
      await clearButton.click()
    } else {
      // Fallback: clear input manually
      await searchInput.clear()
    }

    await page.waitForTimeout(400)

    // Both should be visible again
    await expect(page.getByText('Test Expense One')).toBeVisible()
    await expect(page.getByText('Test Expense Two')).toBeVisible()
  })

  test('search persists while typing', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `Type Persist ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await navigateToGroup(page, groupId)

    await createExpense(page, {
      title: 'Electricity Bill',
      amount: '150.00',
      payer: 'Alice',
    })

    await createExpense(page, {
      title: 'Electric Car Charging',
      amount: '45.00',
      payer: 'Bob',
    })

    await createExpense(page, {
      title: 'Water Bill',
      amount: '30.00',
      payer: 'Alice',
    })

    const searchInput = page.getByPlaceholder(/search/i)

    // Type "Elec" progressively
    await searchInput.fill('E')
    await page.waitForTimeout(400)

    // Should still show Electric items
    await searchInput.fill('Elec')
    await page.waitForTimeout(400)

    await expect(page.getByText('Electricity Bill')).toBeVisible()
    await expect(page.getByText('Electric Car Charging')).toBeVisible()
    await expect(page.getByText('Water Bill')).not.toBeVisible()
  })
})
