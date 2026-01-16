import { expect, test } from '@playwright/test'

test('create group - happy path', async ({ page }) => {
  const groupName = `PW E2E group ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).first().click()

  await page.getByLabel('Group name').fill(groupName)

  // Default participants are localized (John/Jane/Jack). Overwrite all 3.
  // Accessible name is the placeholder: `GroupForm.Participants.new`.
  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participantA)
  await participantInputs.nth(1).fill(participantB)
  await participantInputs.nth(2).fill('Charlie')

  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page).toHaveURL(/\/groups\/[^/]+$/)

  // Show balances tab; this page is stable for participant assertions.
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(page.getByText(participantA, { exact: true })).toBeVisible()
  await expect(page.getByText(participantB, { exact: true })).toBeVisible()
})
