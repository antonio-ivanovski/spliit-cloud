import { expect, test } from '@playwright/test'
import { createExpense, createGroup, navigateToTab } from '../helpers'

test('View statistics page', async ({ page }) => {
  const groupName = `PW E2E stats ${Date.now()}`

  await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await navigateToTab(page, 'Stats')

  await expect(
    page.getByRole('heading', { name: /statistics|stats/i }),
  ).toBeVisible()
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

  // Total should be 35.50
  await expect(page.getByText(/Total group spendings/i)).toBeVisible()
  await expect(page.getByText(/35\.50/)).toBeVisible()
})

test('Verify User Paid and Share', async ({ page }) => {
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
  await createExpense(page, {
    title: 'Dinner',
    amount: '30.00',
    payer: participantA,
  })
  await createExpense(page, {
    title: 'Taxi',
    amount: '15.00',
    payer: participantB,
  })

  // Select Alice as active user via Settings
  await navigateToTab(page, 'Settings')
  await page.getByRole('combobox').last().click()
  await page.getByRole('option', { name: participantA }).click()
  await page.getByRole('button', { name: /save/i }).click()

  await navigateToTab(page, 'Stats')

  // Alice paid 30.00
  await expect(page.getByText(/Your total spendings/i)).toBeVisible()
  await expect(page.getByText(/30\.00/)).toBeVisible()

  // Alice share is 10 (from Dinner) + 5 (from Taxi) = 15.00
  await expect(page.getByText(/Your total share/i)).toBeVisible()
  await expect(page.getByText(/15\.00/)).toBeVisible()
})
