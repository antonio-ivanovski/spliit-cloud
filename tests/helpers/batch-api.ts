import { createExpense } from './expense'
import { createGroup } from './group'
import { type Page } from '@playwright/test'

// Re-export the existing helpers for convenience
export { createExpense, createGroup }

/**
 * Creates a group with specified name and participants
 * This is an alias to createGroup with a simplified signature for batch operations
 *
 * @param page Playwright page context
 * @param groupName Name of the group to create
 * @param participants List of participant names
 * @param currency Currency code (default: 'USD')
 * @returns The groupId of the created group
 */
export async function createGroupViaAPI(
  page: Page,
  groupName: string,
  participants: string[],
  currency = 'USD',
): Promise<string> {
  const groupId = await createGroup({
    page,
    groupName,
    participants,
  })
  return groupId
}

/**
 * Creates multiple expenses quickly by leveraging existing UI helpers efficiently
 * Much faster than creating them one-by-one with full page navigation
 *
 * This function creates `count` expenses by:
 * 1. Navigating to the group page once
 * 2. Using the optimized createExpense helper multiple times
 * 3. Rotating through provided payer names for variety
 *
 * @param page Playwright page context
 * @param groupId The group ID where expenses will be created
 * @param count Number of expenses to create
 * @param payerNames List of payer names to rotate through
 * @returns Array of expense titles that were created
 */
export async function createExpensesViaAPI(
  page: Page,
  groupId: string,
  count: number,
  payerNames: string[] = ['Alice', 'Bob'],
): Promise<string[]> {
  const expenseTitles: string[] = []

  // Navigate to the group page once and stay there
  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Create expenses one by one
  for (let i = 1; i <= count; i++) {
    const title = `Expense ${String(i).padStart(2, '0')}`
    const amount = String(10 + i) // Varying amounts for realism
    const payerName = payerNames[i % payerNames.length]!

    // Use the existing createExpense helper
    await createExpense(page, {
      title,
      amount,
      payer: payerName,
    })

    expenseTitles.push(title)
  }

  return expenseTitles
}
