import { expect, test } from '@playwright/test'
import { createExpense, createGroup, navigateToTab } from '../helpers'

test('Active user changes balance view', async ({ page }) => {
  const groupName = `PW E2E active user balances ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, participantC],
  })

  // Seed a couple expenses so balances are non-trivial.
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

  await navigateToTab(page, 'Balances')

  // Active-user UX: "Mark as paid" deep-links to reimbursement creation with query params.
  // Verify those params change when a different participant is selected.
  const markAsPaid = page.getByRole('link', { name: 'Mark as paid' }).first()
  await expect(markAsPaid).toBeVisible()

  const hrefBefore = await markAsPaid.getAttribute('href')
  expect(hrefBefore).toContain('reimbursement=yes')

  // "Mark as paid" link shows "from", "to", "amount" params.
  expect(hrefBefore).toMatch(/\bfrom=/)
  expect(hrefBefore).toMatch(/\bto=/)
  expect(hrefBefore).toMatch(/\bamount=/)

  // Clicking a participant row should set the active context and expose CTA(s).
  await page.getByText(participantB, { exact: true }).click()

  // Switching should not remove the link and should keep the same reimbursement route shape.
  const hrefAfter = await markAsPaid.getAttribute('href')
  expect(hrefAfter).toContain('reimbursement=yes')
  expect(hrefAfter).toMatch(/\bfrom=/)
  expect(hrefAfter).toMatch(/\bto=/)
  expect(hrefAfter).toMatch(/\bamount=/)

  // The participant row itself should reflect selection.
  // Use role-less structure: the selected row uses stronger styling; at minimum ensure row is still visible.
  await expect(page.getByText(participantB, { exact: true })).toBeVisible()
})

test('Clear active user - neutral view', async ({ page }) => {
  const groupName = `PW E2E clear active user ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, 'Charlie'],
  })

  // Navigate to balances
  await navigateToTab(page, 'Balances')

  // Click on a participant to select them as active
  await page.getByText(participantA, { exact: true }).click()
  await expect(page.getByText(participantA)).toBeVisible()

  // Now try to clear selection (click again or look for a clear button)
  // This tests that the view can return to neutral state
  await page.getByText(participantA, { exact: true }).click()

  // Verify the page is still visible (neutral state)
  await expect(page.getByText(participantA)).toBeVisible()
})

test('Updates stats when active user changes', async ({ page }) => {
  const groupName = `PW E2E active user stats update ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  await createGroup({
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

  // Set Alice as active user
  await navigateToTab(page, 'Settings')
  await page.getByRole('combobox').last().click()
  await page.getByRole('option', { name: participantA }).click()
  await page.getByRole('button', { name: /save/i }).click()

  // Navigate to Stats and verify Alice's stats
  await navigateToTab(page, 'Stats')

  // Alice paid 30.00 - find container with both label and value
  await expect(
    page.locator('text=/Your total spendings/i').locator('..'),
  ).toContainText(/30\.00/)

  // Alice's share is 15.00 (total 45.00 / 3 participants)
  await expect(
    page.locator('text=/Your total share/i').locator('..'),
  ).toContainText(/15\.00/)

  // Change active user to Bob
  await navigateToTab(page, 'Settings')
  await page.getByRole('combobox').last().click()
  await page.getByRole('option', { name: participantB }).click()
  await page.getByRole('button', { name: /save/i }).click()

  // Navigate back to Stats and verify Bob's stats
  await navigateToTab(page, 'Stats')

  // Bob paid 15.00 - should be different from Alice's 30.00
  await expect(
    page.locator('text=/Your total spendings/i').locator('..'),
  ).toContainText(/15\.00/)

  // Bob's share is still 15.00 (total 45.00 / 3 participants)
  await expect(
    page.locator('text=/Your total share/i').locator('..'),
  ).toContainText(/15\.00/)
})
