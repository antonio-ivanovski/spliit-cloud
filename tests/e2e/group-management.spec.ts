import { expect, test } from '@playwright/test'

test('create group - happy path', async ({ page }) => {
  const groupName = `PW E2E group ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  // Step 1: Navigate to groups page
  await page.goto('/groups')

  // Step 2: Click create group button/link
  await page.getByRole('link', { name: 'Create' }).click()

  // Step 3: Fill in group name
  await page.getByLabel('Group name').fill(groupName)

  // Step 4: Fill in participants
  // Default participants are localized (John/Jane/Jack). Overwrite all 3.
  // Accessible name is the placeholder: `GroupForm.Participants.new`.
  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participantA)
  await participantInputs.nth(1).fill(participantB)
  await participantInputs.nth(2).fill('Charlie')

  // Step 5: Currency selection
  // Currency is handled by CurrencySelector component with role="combobox"
  // It defaults to NEXT_PUBLIC_DEFAULT_CURRENCY_CODE
  // The currency button is present but does not require manual selection for the happy path

  // Step 6: Submit the form
  await page.getByRole('button', { name: 'Create' }).click()

  // Step 7: Verify group was created
  // Check URL changed to group detail page (/groups/[groupId])
  await expect(page).toHaveURL(/\/groups\/[^/]+$/)

  // Verify group page is visible by checking for the Balances tab
  const balancesTab = page.getByRole('tab', { name: 'Balances' })
  await expect(balancesTab).toBeVisible()

  // Click on Balances tab to stabilize the page
  await balancesTab.click()

  // Verify participants are visible on the page
  await expect(page.getByText(participantA, { exact: true })).toBeVisible()
  await expect(page.getByText(participantB, { exact: true })).toBeVisible()

  // Verify group name is displayed (use exact match to avoid strict mode violation)
  await expect(page.getByText(groupName, { exact: true })).toBeVisible()
})
