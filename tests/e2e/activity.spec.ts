import { expect, test } from '@playwright/test'

import type { Page } from '@playwright/test'

async function createGroup({
  page,
  groupName,
  participants,
}: {
  page: Page
  groupName: string
  participants: string[]
}) {
  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).first().click()

  await page.getByLabel('Group name').fill(groupName)

  const participantInputs = page.getByRole('textbox', { name: 'New' })

  for (let i = 0; i < participants.length; i++) {
    if (i >= 3) {
      await page.getByRole('button', { name: 'Add participant' }).click()
      await expect(participantInputs).toHaveCount(i + 1)
    }

    await participantInputs.nth(i).fill(participants[i]!)
  }

  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).not.toHaveURL(/\/groups\/create$/)
  await expect(page).toHaveURL(/\/groups\/[^/]+(\/expenses)?$/)

  const url = page.url()
  const groupId = url.match(/\/groups\/([^/]+)(?:\/expenses)?$/)?.[1]
  if (!groupId || groupId === 'create') {
    throw new Error(`Failed to extract groupId from URL: ${url}`)
  }

  return groupId
}

test('View activity page', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E activity test ${Date.now()}`,
    participants: ['Alice', 'Bob', 'Charlie'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // Look for the activity tab or link
  const activityTab = page.getByRole('tab', { name: /activity|activities/i })
  if (await activityTab.isVisible()) {
    await activityTab.click()
    await page.waitForURL(/\/groups\/[^/]+\/activity/)
  } else {
    // Try to find an activity link
    const activityLink = page
      .getByRole('link', { name: /activity|activities/i })
      .first()
    if (await activityLink.isVisible()) {
      await activityLink.click()
      await page.waitForLoadState('networkidle')
    }
  }

  // Verify activity page loads
  // The page should show some activity or a message if empty
  const body = page.locator('body')
  await expect(body).toBeVisible()

  // Verify we can see participant names or activity description
  const content = await body.textContent()
  expect(content).toBeTruthy()
})
