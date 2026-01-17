import type { Page } from '@playwright/test'

export type GroupTab =
  | 'Expenses'
  | 'Balances'
  | 'Stats'
  | 'Settings'
  | 'Information'
  | 'Activity'

const TAB_URL_PATTERNS: Record<GroupTab, RegExp> = {
  Expenses: /\/groups\/[^/]+\/expenses$/,
  Balances: /\/groups\/[^/]+\/balances$/,
  Stats: /\/groups\/[^/]+\/stats$/,
  Settings: /\/groups\/[^/]+\/edit$/,
  Information: /\/groups\/[^/]+\/information$/,
  Activity: /\/groups\/[^/]+\/activity$/,
}

/**
 * Navigates to a group's expenses page with proper handling of redirects.
 * The /groups/{id} page redirects to /groups/{id}/expenses, so we navigate
 * directly to the final URL to avoid timing issues in webkit.
 */
export async function navigateToGroup(
  page: Page,
  groupId: string,
): Promise<void> {
  await page.goto(`/groups/${groupId}/expenses`)
  await page.waitForURL(/\/groups\/[^/]+\/expenses$/)
}

/**
 * Navigates to a specific tab in the group view
 */
export async function navigateToTab(page: Page, tab: GroupTab): Promise<void> {
  const tabButton = page.getByRole('tab', { name: tab })
  await tabButton.waitFor({ state: 'visible' })
  await tabButton.click()
  await page.waitForURL(TAB_URL_PATTERNS[tab])
}
