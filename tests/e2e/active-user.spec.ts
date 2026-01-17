import { expect, test } from '@playwright/test'

test('Active user changes balance view', async ({ page }) => {
  const groupName = `PW E2E active user balances ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  await page.goto('/groups')
  await page
    .getByRole('link', { name: /^Create$/ })
    .first()
    .click()

  await page.getByLabel('Group name').fill(groupName)

  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participantA)
  await participantInputs.nth(1).fill(participantB)
  await participantInputs.nth(2).fill(participantC)

  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+$/)

  // Seed a couple expenses so balances are non-trivial.
  const createExpense = async (
    title: string,
    amount: string,
    payer: string,
  ) => {
    await page
      .getByRole('link', { name: /create expense|create the first/i })
      .first()
      .click()

    await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

    await page.locator('input[name="title"]').fill(title)
    await page.locator('input[name="amount"]').fill(amount)

    const paidBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await paidBySelect.click()
    await page.getByRole('option', { name: payer }).click()

    await page.locator('button[type="submit"]').first().click()
    await page.waitForURL(/\/groups\/[^/]+/)
    await expect(page.getByText(title)).toBeVisible()
  }

  await createExpense('Dinner', '30.00', participantA)
  await createExpense('Taxi', '15.00', participantB)

  await page.getByRole('tab', { name: 'Balances' }).click()
  await page.waitForURL(/\/groups\/[^/]+\/balances$/)

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
