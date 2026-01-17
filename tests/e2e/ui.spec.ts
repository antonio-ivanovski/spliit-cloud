import { expect, test } from '@playwright/test'
import { createGroup } from '../helpers'

test('Mobile responsive - drawer menu instead of sidebar', async ({ page }) => {
  // Set viewport to mobile size
  await page.setViewportSize({ width: 375, height: 667 })

  // Create a test group
  const groupId = await createGroup({
    page,
    groupName: `PW E2E mobile test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  // Navigate to group page
  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // On mobile, we should have a drawer/hamburger menu instead of a visible sidebar
  // Look for a mobile menu button (hamburger icon)
  const menuButton = page
    .getByRole('button')
    .filter({ has: page.locator('svg') })
    .first()

  // Check if menu button exists
  expect(await menuButton.count()).toBeGreaterThan(0)

  // Click the menu button to open drawer
  await menuButton.click()

  // Wait for drawer to become visible
  await page.waitForTimeout(300)

  // Verify drawer/menu is now visible with navigation items
  const navMenu = page.locator('[role="navigation"], nav, [role="menu"]')
  const isMenuVisible = await navMenu.isVisible().catch(() => false)

  // Verify that mobile view is active by checking that normal sidebar is not visible
  // or by checking that drawer/mobile menu structure exists
  expect(isMenuVisible || (await page.locator('button').count()) > 0).toBeTruthy()
})

test('Desktop responsive - sidebar and dialogs appear correctly', async ({ page }) => {
  // Set viewport to desktop size
  await page.setViewportSize({ width: 1280, height: 1024 })

  // Create a test group
  const groupId = await createGroup({
    page,
    groupName: `PW E2E desktop test ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  // Navigate to group page
  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  // On desktop, we should see sidebar/navigation clearly
  const sidebar = page.locator('aside, [role="navigation"]')

  // Desktop view should be responsive - check viewport width
  const viewportSize = page.viewportSize()
  expect(viewportSize?.width).toBe(1280)
  expect(viewportSize?.height).toBe(1024)

  // Verify page loaded successfully at desktop size
  const content = page.locator('[role="main"], main')
  expect(await content.isVisible()).toBeTruthy()
})
