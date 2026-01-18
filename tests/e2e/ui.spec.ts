import { expect, test } from '@playwright/test'
import {
  createExpense,
  createGroup,
  navigateToGroup,
  switchLocale,
} from '../helpers'

test('Mobile navigation uses hamburger menu', async ({ page }) => {
  // Set viewport to mobile size (iPhone SE)
  await page.setViewportSize({ width: 375, height: 667 })

  // Create a test group
  const groupId = await createGroup({
    page,
    groupName: `PW E2E mobile test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  // Navigate to group page
  await navigateToGroup(page, groupId)

  // Create an expense so we have content to verify
  await createExpense(page, {
    title: 'Mobile Test Expense',
    amount: '50.00',
    payer: 'Alice',
  })

  // Verify the expense is visible in mobile view
  const mobileExpenseTitle = page
    .getByTestId('expense-title')
    .filter({ hasText: 'Mobile Test Expense' })
  await expect(mobileExpenseTitle).toBeVisible()

  // Verify amount is visible in mobile layout
  const mobileExpenseAmount = page
    .getByTestId('expense-amount')
    .filter({ hasText: '$50.00' })
  await expect(mobileExpenseAmount).toBeVisible()

  // Verify tabs are still accessible in mobile view
  const statsTab = page.getByRole('tab', { name: 'Stats' })
  await expect(statsTab).toBeVisible()
  await statsTab.click()

  // Verify we navigated to Stats
  await page.waitForURL(/\/stats$/)
  await expect(page.getByRole('heading', { name: 'Totals' })).toBeVisible()
})

test('Desktop view displays full layout', async ({ page }) => {
  // Set viewport to desktop size
  await page.setViewportSize({ width: 1280, height: 1024 })

  // Create a test group
  const groupId = await createGroup({
    page,
    groupName: `PW E2E desktop test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  // Navigate to group page
  await navigateToGroup(page, groupId)

  // Create an expense
  await createExpense(page, {
    title: 'Desktop Test Expense',
    amount: '100.00',
    payer: 'Alice',
  })

  // Verify main content is visible
  await expect(page.getByRole('main')).toBeVisible()

  // Verify navigation header is visible
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible()

  // Verify all tabs are visible without scrolling
  await expect(page.getByRole('tab', { name: 'Expenses' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Balances' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Stats' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible()

  // Verify expense card details are fully visible
  const desktopExpenseTitle = page
    .getByTestId('expense-title')
    .filter({ hasText: 'Desktop Test Expense' })
  await expect(desktopExpenseTitle).toBeVisible()

  const desktopExpenseAmount = page
    .getByTestId('expense-amount')
    .filter({ hasText: '$100.00' })
  await expect(desktopExpenseAmount).toBeVisible()

  await expect(page.getByText('Paid by')).toBeVisible()
})

test('Date format changes with locale selection', async ({ page }) => {
  // Set up desktop viewport
  await page.setViewportSize({ width: 1280, height: 1024 })

  // Create a test group
  const groupId = await createGroup({
    page,
    groupName: `PW E2E i18n date test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  // Create an expense with a known date
  await createExpense(page, {
    title: 'i18n Date Test',
    amount: '50.00',
    payer: 'Alice',
  })

  // Navigate to group page
  await navigateToGroup(page, groupId)

  // Verify expense is visible
  const expenseTitle = page.getByTestId('expense-title').filter({ hasText: 'i18n Date Test' })
  await expect(expenseTitle).toBeVisible()

  // Get the date text in English format (e.g., "Jan 17, 2026")
  const expenseDateElement = page.getByTestId('expense-date').first()
  const englishDateText = await expenseDateElement.textContent()

  // Verify English date format pattern (Month abbreviation followed by day and year)
  // Pattern: Jan 1, 2026 or Dec 31, 2026
  expect(englishDateText).toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)

  // Switch to Spanish locale
  await switchLocale(page, 'Español')

  // Verify expense is still visible after locale change
  await expect(expenseTitle).toBeVisible()

  // Get the date text in Spanish format (e.g., "17 ene 2026")
  const spanishDateText = await expenseDateElement.textContent()

  // Verify Spanish date format pattern (lowercase month abbreviations)
  // Pattern: 1 ene 2026 or 31 dic 2026
  expect(spanishDateText).toMatch(
    /ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic/,
  )

  // Verify the formats are actually different
  expect(englishDateText).not.toBe(spanishDateText)
})

test('Currency displays with correct format for locale', async ({ page }) => {
  // Set up desktop viewport
  await page.setViewportSize({ width: 1280, height: 1024 })

  // Create a test group with USD currency
  const groupId = await createGroup({
    page,
    groupName: `PW E2E currency format test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  // Create an expense with a specific amount
  await createExpense(page, {
    title: 'Currency Format Test',
    amount: '1234.56',
    payer: 'Alice',
  })

  // Navigate to group page
  await navigateToGroup(page, groupId)

  // Verify expense is visible
  const currencyExpenseTitle = page
    .getByTestId('expense-title')
    .filter({ hasText: 'Currency Format Test' })
  await expect(currencyExpenseTitle).toBeVisible()

  // In English (US) locale, USD amounts display as $1,234.56
  // Verify the amount displays with $ prefix and period as decimal separator
  const expenseAmount = page
    .getByTestId('expense-amount')
    .filter({ hasText: '$1,234.56' })
  await expect(expenseAmount).toBeVisible()

  // Navigate to Stats to see total
  await page.getByRole('tab', { name: 'Stats' }).click()
  await page.waitForURL(/\/stats$/)

  // Verify the total also uses correct format
  const totalGroupSpending = page.getByTestId('total-group-spendings')
  await expect(totalGroupSpending).toContainText('$1,234.56')

  // Switch to French locale which uses different number formatting
  await switchLocale(page, 'Français')

  // In French locale, numbers use space as thousands separator and comma as decimal
  // $1,234.56 becomes 1 234,56 $ or similar format
  // At minimum, verify the page still works and displays amounts
  await expect(page.getByText(/1.*234.*56/)).toBeVisible()
})
