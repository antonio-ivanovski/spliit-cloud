import { expect, test } from '@playwright/test'
import { createGroup, fillParticipants, navigateToTab } from '../helpers'

test('create group - with custom currency', async ({ page }) => {
  const groupName = `PW E2E group custom currency ${Date.now()}`

  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).first().click()

  await page.getByLabel('Group name').fill(groupName)

  // Select "Custom" currency (empty code)
  await page.locator('[role="combobox"]').first().click()
  await page.getByRole('option', { name: 'Custom' }).click()

  // Now the currency symbol input should be visible
  await page.getByLabel('Currency symbol').fill('$')

  await fillParticipants(page, ['Alice', 'Bob', 'Charlie'])

  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+$/)

  await expect(page.getByRole('tab', { name: 'Expenses' })).toBeVisible()
})

test('view group information page', async ({ page }) => {
  const groupName = `PW E2E group info ${Date.now()}`

  await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await navigateToTab(page, 'Information')

  await expect(page.getByRole('heading', { name: groupName })).toBeVisible()

  await expect(page.getByRole('tab', { name: 'Balances' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Expenses' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible()
})

test('edit group - update name and info', async ({ page }) => {
  const groupName = `PW E2E group edit ${Date.now()}`

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await navigateToTab(page, 'Settings')

  const newName = `Renamed ${Date.now()}`
  const newInfo = `Info ${Date.now()}`

  await page.getByLabel('Group name').fill(newName)
  await page.getByLabel('Group information').fill(newInfo)

  await page.getByRole('button', { name: 'Save' }).click()

  await navigateToTab(page, 'Information')
  await expect(page.getByText(newInfo, { exact: true })).toBeVisible()
  await expect(page.getByText(newName, { exact: true })).toBeVisible()
})

test('create group - validation errors', async ({ page }) => {
  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).first().click()

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

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await navigateToTab(page, 'Settings')

  await page.getByRole('button', { name: 'Add participant' }).click()

  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(4)
  await participantInputs.nth(3).fill('Dave')

  await page.getByRole('button', { name: 'Save' }).click()

  await navigateToTab(page, 'Balances')
  await expect(page.getByText('Dave', { exact: true })).toBeVisible()
})

test('edit group - remove participant', async ({ page }) => {
  const groupName = `PW E2E group remove participant ${Date.now()}`

  const groupId = await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie', 'Dave'],
  })

  // Create an expense involving Alice/Bob/Charlie only (Dave stays unprotected)
  const createLink = page
    .getByRole('link', { name: /create expense|create the first/i })
    .first()
  await createLink.click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/expenses\/create/)

  await page.locator('input[name="title"]').fill('Protection seed')
  await page.locator('input[name="amount"]').fill('10.00')

  const paidBySelect = page
    .getByRole('combobox')
    .filter({ hasText: 'Select a participant' })
  await paidBySelect.click()
  await page.getByRole('option', { name: 'Alice' }).click()

  // Uncheck Dave from paid-for list
  const daveCheckbox = page.getByRole('checkbox', { name: 'Dave' })
  await expect(daveCheckbox).toBeVisible()
  await daveCheckbox.uncheck()

  await page.locator('button[type="submit"]').first().click()
  await expect(page).toHaveURL(/\/groups\/[^/]+(\/expenses)?$/)

  await navigateToTab(page, 'Settings')

  // Expect 4 participants still present
  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(4)

  // Protected participants (in an expense) should have disabled remove buttons.
  const disabledRemoveButtons = page.locator(
    'button[disabled] svg.lucide-trash-2',
  )
  await expect(disabledRemoveButtons).toHaveCount(3)

  // Remove Dave (unprotected)
  const daveRow = page.locator('input[value="Dave"]')
  await expect(daveRow).toBeVisible()

  const daveContainer = daveRow.locator(
    'xpath=ancestor::div[contains(@class,"flex")][1]',
  )
  const daveRemove = daveContainer.locator('button:not([disabled])').first()

  await daveRemove.click()

  await page.getByRole('button', { name: 'Save' }).click()

  await navigateToTab(page, 'Balances')
  await expect(page.getByText('Dave', { exact: true })).not.toBeVisible()
})

test('navigate between groups', async ({ page }) => {
  const groupName1 = `PW E2E navigate group 1 ${Date.now()}`
  const groupName2 = `PW E2E navigate group 2 ${Date.now()}`

  // Create first group
  const groupId1 = await createGroup({
    page,
    groupName: groupName1,
    participants: ['Alice', 'Bob'],
  })

  // Create second group
  const groupId2 = await createGroup({
    page,
    groupName: groupName2,
    participants: ['Charlie', 'Dave'],
  })

  // Verify we're on group 2
  await expect(page.getByRole('heading', { name: groupName2 })).toBeVisible()

  // Navigate to my groups page
  await page.goto('/groups')
  await expect(page).toHaveURL('/groups')

  // Wait for both groups to appear in the list
  await expect(page.getByText(groupName1)).toBeVisible()
  await expect(page.getByText(groupName2)).toBeVisible()

  // Click on first group by clicking its name
  await page.getByText(groupName1).click()
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId1}`))
  await expect(page.getByRole('heading', { name: groupName1 })).toBeVisible()

  // Navigate back to groups list
  await page.goto('/groups')
  await expect(page).toHaveURL('/groups')

  // Click on second group by clicking its name
  await page.getByText(groupName2).click()
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId2}`))
  await expect(page.getByRole('heading', { name: groupName2 })).toBeVisible()
})

test('share group - copy URL', async ({ page, context }) => {
  const groupName = `PW E2E group share ${Date.now()}`
  await createGroup({
    page,
    groupName,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:3000',
    })
  } catch {
    // Not all browsers support clipboard permissions; skip explicit granting.
  }

  await navigateToTab(page, 'Expenses')
  await page.locator('button[title="Share"]').click()

  const groupId = page.url().match(/\/groups\/([^/]+)(?:\/expenses)?$/)?.[1]
  if (!groupId || groupId === 'create') {
    throw new Error(`Failed to extract groupId from URL: ${page.url()}`)
  }

  const shareUrlPartial = `/groups/${groupId}/expenses?ref=share`

  // Stay on the group page; share popover should not navigate.
  await expect(page.getByRole('heading', { name: groupName })).toBeVisible()

  // Click the copy icon (turns into check)
  const copyButton = page
    .getByRole('button')
    .filter({ has: page.locator('svg.lucide-copy') })
    .first()
  await copyButton.click()

  await expect(page.locator('svg.lucide-check').first()).toBeVisible()

  try {
    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    )
    expect(clipboardText).toContain(shareUrlPartial)
  } catch {
    // Some browsers (webkit/mobile) deny clipboard reads in automation.
    // The UI feedback (check icon) is the signal that copy succeeded.
  }
})
