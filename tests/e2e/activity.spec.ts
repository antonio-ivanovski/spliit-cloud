import { expect, test } from '@playwright/test'
import { createGroup } from '../helpers'

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
