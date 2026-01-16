import { expect, test } from '@playwright/test'

import type { Page } from '@playwright/test'

async function createGroup({
  page,
  groupName,
  participants,
}: {
  page: Page
  groupName: string
  participants: [string, string, string]
}) {
  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).click()

  await page.getByLabel('Group name').fill(groupName)

  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill(participants[0])
  await participantInputs.nth(1).fill(participants[1])
  await participantInputs.nth(2).fill(participants[2])

  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+$/)
}

test('create group - happy path', async ({ page }) => {
  const groupName = `PW E2E group ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, 'Charlie'],
  })

  const balancesTab = page.getByRole('tab', { name: 'Balances' })
  await expect(balancesTab).toBeVisible()
  await balancesTab.click()

  await expect(page.getByText(participantA, { exact: true })).toBeVisible()
  await expect(page.getByText(participantB, { exact: true })).toBeVisible()
  await expect(page.getByText(groupName, { exact: true })).toBeVisible()
})

test('create group - with custom currency', async ({ page }) => {
  const groupName = `PW E2E group custom currency ${Date.now()}`

  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).click()

  await page.getByLabel('Group name').fill(groupName)

  // Select “Custom” currency (empty code)
  // The currency selector is a button with role=combobox (label sits outside).
  await page.locator('[role="combobox"]').first().click()
  await page.getByRole('option', { name: 'Custom' }).click()

  // Now the currency symbol input should be visible
  await page.getByLabel('Currency symbol').fill('¤')

  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill('Alice')
  await participantInputs.nth(1).fill('Bob')
  await participantInputs.nth(2).fill('Charlie')

  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+$/)

  // Spot-check UI renders and doesn’t crash with custom currency
  await expect(page.getByRole('tab', { name: 'Expenses' })).toBeVisible()
})

test('edit group - update name and info', async ({ page }) => {
  const groupName = `PW E2E group edit ${Date.now()}`

  await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/edit$/)

  const newName = `Renamed ${Date.now()}`
  const newInfo = `Info ${Date.now()}`

  await page.getByLabel('Group name').fill(newName)
  await page.getByLabel('Group information').fill(newInfo)

  await page.getByRole('button', { name: 'Save' }).click()

  await page.getByRole('tab', { name: 'Information' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/information$/)
  await expect(page.getByText(newInfo, { exact: true })).toBeVisible()
  await expect(page.getByText(newName, { exact: true })).toBeVisible()
})

test('create group - validation errors', async ({ page }) => {
  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).click()

  // Submit empty form
  await page.getByRole('button', { name: 'Create' }).click()

  // name requires min 2
  await expect(
    page.getByText('Enter at least two characters.').first(),
  ).toBeVisible()

  // participant name requires min 2 (at least one will be invalid by default: "New" is placeholder but value is John/Jane/Jack, so clear one)
  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill('A')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByText('Enter at least two characters.').first(),
  ).toBeVisible()

  // duplicate participant names
  await participantInputs.nth(0).fill('Alice')
  await participantInputs.nth(1).fill('Alice')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(
    page.getByText('Another participant already has this name.').first(),
  ).toBeVisible()
})

test('edit group - add participant', async ({ page }) => {
  const groupName = `PW E2E group add participant ${Date.now()}`

  await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/edit$/)

  await page.getByRole('button', { name: 'Add participant' }).click()

  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(4)
  await participantInputs.nth(3).fill('Dave')

  await page.getByRole('button', { name: 'Save' }).click()

  // Verify new participant appears on balances
  await page.getByRole('tab', { name: 'Balances' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/balances$/)
  await expect(page.getByText('Dave', { exact: true })).toBeVisible()
})
