import { expect, test } from '@playwright/test'
import { createGroup, navigateToTab } from '../helpers'

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
