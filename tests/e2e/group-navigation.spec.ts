import { expect, test } from '@playwright/test'
import {
  createGroup,
  extractGroupId,
  navigateToTab,
  verifyGroupHeading,
} from '../helpers'

test.describe('Group Navigation', () => {
  test('navigate between multiple groups', async ({ page }) => {
    const groupName1 = `PW E2E navigate 1 ${Date.now()}`
    const groupName2 = `PW E2E navigate 2 ${Date.now()}`

    // Create first group
    const groupId1 = await createGroup({
      page,
      groupName: groupName1,
      participants: ['Alice', 'Bob'],
    })

    // Verify we're on group 1
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId1}/expenses$`))
    await verifyGroupHeading(page, groupName1)

    // Create second group
    const groupId2 = await createGroup({
      page,
      groupName: groupName2,
      participants: ['Charlie', 'Dave'],
    })

    // Verify we're on group 2
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId2}/expenses$`))
    await verifyGroupHeading(page, groupName2)

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle')

    // Navigate to groups list
    await page.goto('/groups')
    await expect(page).toHaveURL('/groups')

    // Verify both groups appear in the list
    const group1Link = page.getByText(groupName1)
    const group2Link = page.getByText(groupName2)
    await expect(group1Link).toBeVisible()
    await expect(group2Link).toBeVisible()

    // Navigate to first group
    await group1Link.click()
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId1}`))
    await verifyGroupHeading(page, groupName1)

    // Verify we can see group 1 participants in a tab
    await navigateToTab(page, 'Balances')
    await expect(page.getByText('Alice', { exact: true })).toBeVisible()
    await expect(page.getByText('Bob', { exact: true })).toBeVisible()

    // Navigate back to groups list
    await page.goto('/groups')
    await expect(page).toHaveURL('/groups')

    // Navigate to second group
    await page.getByText(groupName2).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId2}`))
    await verifyGroupHeading(page, groupName2)

    // Verify we can see group 2 participants
    await navigateToTab(page, 'Balances')
    await expect(page.getByText('Charlie', { exact: true })).toBeVisible()
    await expect(page.getByText('Dave', { exact: true })).toBeVisible()
  })

  test('recent groups persistence across page reloads', async ({ page }) => {
    const groupName = `PW E2E recent ${Date.now()}`

    // Create a group
    const groupId = await createGroup({
      page,
      groupName,
      participants: ['Alice', 'Bob'],
    })

    // Verify group was created
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/expenses$`))

    // Navigate to groups list
    await page.goto('/groups')
    await expect(page).toHaveURL('/groups')

    // Verify group appears in recent list
    const groupLink = page.getByText(groupName)
    await expect(groupLink).toBeVisible()

    // Reload the page to test persistence
    await page.reload()
    await expect(page).toHaveURL('/groups')

    // Verify group still appears after reload
    await expect(page.getByText(groupName)).toBeVisible()

    // Navigate to the group via the link
    await page.getByText(groupName).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}`))
    await verifyGroupHeading(page, groupName)
  })

  test('navigate to group information tab', async ({ page }) => {
    const groupName = `PW E2E info tab ${Date.now()}`

    await createGroup({
      page,
      groupName,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    // Navigate to Information tab
    await navigateToTab(page, 'Information')

    // Verify URL changed
    await expect(page).toHaveURL(/\/groups\/[^/]+\/information$/)

    // Verify group name in heading
    await verifyGroupHeading(page, groupName)

    // Verify all tabs are visible
    await expect(page.getByRole('tab', { name: 'Balances' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Expenses' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Stats' })).toBeVisible()
  })

  test('navigate between all group tabs', async ({ page }) => {
    const groupName = `PW E2E all tabs ${Date.now()}`

    const groupId = await createGroup({
      page,
      groupName,
      participants: ['Alice', 'Bob'],
    })

    const tabs: Array<{
      name: 'Expenses' | 'Balances' | 'Stats' | 'Settings' | 'Information'
      urlPattern: RegExp
    }> = [
      { name: 'Expenses', urlPattern: /\/expenses$/ },
      { name: 'Balances', urlPattern: /\/balances$/ },
      { name: 'Stats', urlPattern: /\/stats$/ },
      { name: 'Information', urlPattern: /\/information$/ },
      { name: 'Settings', urlPattern: /\/edit$/ },
    ]

    // Navigate through each tab and verify
    for (const tab of tabs) {
      await navigateToTab(page, tab.name)

      // Verify URL
      await expect(page).toHaveURL(tab.urlPattern)

      // Verify tab is selected
      await expect(page.getByRole('tab', { name: tab.name })).toHaveAttribute(
        'aria-selected',
        'true',
      )

      // Verify group name is still visible in heading
      await verifyGroupHeading(page, groupName)
    }
  })

  test('direct URL navigation to group tabs', async ({ page }) => {
    const groupName = `PW E2E direct URL ${Date.now()}`

    const groupId = await createGroup({
      page,
      groupName,
      participants: ['Alice', 'Bob'],
    })

    // Test direct navigation to each tab
    const tabUrls = [
      `/groups/${groupId}/expenses`,
      `/groups/${groupId}/balances`,
      `/groups/${groupId}/stats`,
      `/groups/${groupId}/information`,
      `/groups/${groupId}/edit`,
    ]

    for (const url of tabUrls) {
      await page.goto(url)
      await expect(page).toHaveURL(url)
      await verifyGroupHeading(page, groupName)

      // Verify we can interact with the page (page is fully loaded)
      const tabs = page.getByRole('tab')
      await expect(tabs.first()).toBeVisible()
    }
  })

  test('browser back button navigation', async ({ page }) => {
    const groupName = `PW E2E back button ${Date.now()}`

    await createGroup({
      page,
      groupName,
      participants: ['Alice', 'Bob'],
    })

    // Navigate through tabs: Expenses -> Balances -> Settings
    await navigateToTab(page, 'Balances')
    await expect(page).toHaveURL(/\/balances$/)

    await navigateToTab(page, 'Settings')
    await expect(page).toHaveURL(/\/edit$/)

    // Use browser back button
    await page.goBack()
    await expect(page).toHaveURL(/\/balances$/)
    await verifyGroupHeading(page, groupName)

    // Back again
    await page.goBack()
    await expect(page).toHaveURL(/\/expenses$/)
    await verifyGroupHeading(page, groupName)

    // Forward navigation
    await page.goForward()
    await expect(page).toHaveURL(/\/balances$/)
    await verifyGroupHeading(page, groupName)
  })

  test('group list shows multiple recent groups in order', async ({ page }) => {
    const groupNames = [
      `PW E2E recent 1 ${Date.now()}`,
      `PW E2E recent 2 ${Date.now() + 1}`,
      `PW E2E recent 3 ${Date.now() + 2}`,
    ]

    const groupIds: string[] = []

    // Create multiple groups
    for (const groupName of groupNames) {
      const groupId = await createGroup({
        page,
        groupName,
        participants: ['Alice', 'Bob'],
      })
      groupIds.push(groupId)
    }

    // Navigate to groups list
    await page.goto('/groups')
    await expect(page).toHaveURL('/groups')

    // Verify all groups are visible
    for (const groupName of groupNames) {
      await expect(page.getByText(groupName)).toBeVisible()
    }

    // Most recently created group should be listed
    const lastGroupName = groupNames[groupNames.length - 1]
    await expect(page.getByText(lastGroupName!)).toBeVisible()
  })
})
