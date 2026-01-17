import { expect, type Page } from '@playwright/test'

export interface CreateExpenseOptions {
  title: string
  amount: string
  payer: string
  category?: string
  date?: string
  notes?: string
  isReimbursement?: boolean
  splitMode?: 'evenly' | 'shares' | 'percentage' | 'amount'
  splitValues?: Record<string, string>
}

/**
 * Navigates to the expense creation page
 */
export async function navigateToExpenseCreate(page: Page): Promise<void> {
  // The button is an icon button with title "Create expense"
  const createExpenseButton = page.getByRole('link', {
    name: /create expense/i,
  })

  await createExpenseButton.click()
  await page.waitForLoadState('load')
  await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)
}

/**
 * Creates an expense with the specified options
 */
export async function createExpense(
  page: Page,
  options: CreateExpenseOptions,
): Promise<void> {
  await navigateToExpenseCreate(page)
  await fillExpenseForm(page, options)
  await submitExpenseAndVerify(page, options.title)
}

/**
 * Fills the expense form with the provided options
 */
export async function fillExpenseForm(
  page: Page,
  options: CreateExpenseOptions,
): Promise<void> {
  // Wait for form to be visible
  const expenseTitle = page.locator('input[name="title"]')
  await expenseTitle.waitFor({ state: 'visible' })

  // Fill title
  await expenseTitle.fill(options.title)

  // Fill amount
  const amountInput = page.locator('input[name="amount"]')
  await amountInput.fill(options.amount)

  // Select payer
  const paidBySelect = page
    .getByRole('combobox')
    .filter({ hasText: 'Select a participant' })
  await paidBySelect.waitFor({ state: 'visible' })
  await paidBySelect.click()

  const payerOption = page.getByRole('option', { name: options.payer })
  await payerOption.waitFor({ state: 'visible' })
  await payerOption.click()

  // Optional: Select category
  if (options.category) {
    const categorySelects = page.locator('[role="combobox"]')
    if ((await categorySelects.count()) >= 2) {
      await categorySelects.nth(1).click()
      await page.getByRole('option', { name: options.category }).click()
    }
  }

  // Optional: Set date
  if (options.date) {
    const dateInputs = page.locator('input[type="date"]')
    if ((await dateInputs.count()) > 0) {
      await dateInputs.first().fill(options.date)
    }
  }

  // Optional: Add notes
  if (options.notes) {
    const textareas = page.locator('textarea')
    if ((await textareas.count()) > 0) {
      await textareas.first().fill(options.notes)
    }
  }

  // Optional: Check reimbursement checkbox
  if (options.isReimbursement) {
    const reimbursementLabel = page.getByText(/this is a reimbursement/i)
    await reimbursementLabel.click()
  }
}

/**
 * Submits the expense form and verifies it was created
 */
export async function submitExpenseAndVerify(
  page: Page,
  expenseTitle: string,
): Promise<void> {
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL(/\/groups\/[^/]+/)
  await expect(page.getByText(expenseTitle)).toBeVisible()
}
