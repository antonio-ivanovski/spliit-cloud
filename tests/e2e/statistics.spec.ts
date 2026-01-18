import { expect, test } from '@playwright/test'
import {
  createExpense,
  createGroup,
  navigateToTab,
  setActiveUser,
} from '../helpers'

test('View statistics page', async ({ page }) => {
  const groupName = `PW E2E stats ${Date.now()}`

  await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await navigateToTab(page, 'Stats')

  // Verify the Totals heading is visible
  await expect(page.getByRole('heading', { name: 'Totals' })).toBeVisible()

  // Verify "Total group spendings" label is present
  await expect(page.getByText('Total group spendings')).toBeVisible()
})

test('Verify Group Total', async ({ page }) => {
  const groupName = `PW E2E group total ${Date.now()}`

  await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  // Add expenses
  await createExpense(page, {
    title: 'Dinner',
    amount: '10.00',
    payer: 'Alice',
  })
  await createExpense(page, {
    title: 'Drinks',
    amount: '20.50',
    payer: 'Bob',
  })
  await createExpense(page, {
    title: 'Snacks',
    amount: '5.00',
    payer: 'Charlie',
  })

  await navigateToTab(page, 'Stats')

  // Verify total is exactly 35.50 (10.00 + 20.50 + 5.00)
  const totalGroupSpendings = page.getByTestId('total-group-spendings')
  await expect(totalGroupSpendings).toBeVisible()

  // Check for the specific amount with $ symbol
  await expect(totalGroupSpendings).toContainText('$35.50')
})

test('User statistics calculate paid and share correctly', async ({ page }) => {
  const groupName = `PW E2E user stats ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  const groupId = await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, participantC],
  })

  // Add expenses
  // Alice pays $30 for all 3 people (split evenly: $10 each)
  await createExpense(page, {
    title: 'Dinner',
    amount: '30.00',
    payer: participantA,
  })
  // Bob pays $15 for all 3 people (split evenly: $5 each)
  await createExpense(page, {
    title: 'Taxi',
    amount: '15.00',
    payer: participantB,
  })

  // Select Alice as active user via Settings
  await setActiveUser(page, participantA)

  await navigateToTab(page, 'Stats')

  // Verify Alice's total spendings: $30.00 (what she paid)
  const yourSpendings = page.getByTestId('your-total-spendings')
  await expect(yourSpendings).toBeVisible()
  await expect(yourSpendings).toContainText('$30.00')

  // Verify Alice's share: $15.00 ($10 from Dinner + $5 from Taxi)
  const yourShare = page.getByTestId('your-total-share')
  await expect(yourShare).toBeVisible()
  await expect(yourShare).toContainText('$15.00')
})
