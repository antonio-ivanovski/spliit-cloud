import { expect, test } from '@playwright/test'

test('View statistics page', async ({ page }) => {
  const groupName = `PW E2E stats ${Date.now()}`

  await page.goto('/groups')
  await page
    .getByRole('link', { name: /^Create$/ })
    .first()
    .click()
  await page.getByLabel('Group name').fill(groupName)

  const participantInputs = page.getByRole('textbox', { name: 'New' })
  await expect(participantInputs).toHaveCount(3)
  await participantInputs.nth(0).fill('Alice')
  await participantInputs.nth(1).fill('Bob')
  await participantInputs.nth(2).fill('Charlie')

  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+$/)

  // Stats view is usually a tab.
  const statsTab = page.getByRole('tab', { name: /stats|statistics/i }).first()
  await statsTab.waitFor({ state: 'visible' })
  await statsTab.click()

  await expect(page).toHaveURL(/\/groups\/[^/]+\/(stats|statistics)$/)

  await expect(
    page.getByRole('heading', { name: /statistics|stats/i }),
  ).toBeVisible()
})
