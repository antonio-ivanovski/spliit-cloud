import type { Page } from '@playwright/test'

export type GroupTab =
  | 'Expenses'
  | 'Balances'
  | 'Stats'
  | 'Settings'
  | 'Information'
  | 'Activity'

const TAB_URL_PATTERNS: Record<GroupTab, RegExp> = {
  Expenses: /\/groups\/[^/]+(\/expenses)?$/,
  Balances: /\/groups\/[^/]+\/balances$/,
  Stats: /\/groups\/[^/]+\/stats$/,
  Settings: /\/groups\/[^/]+\/edit$/,
  Information: /\/groups\/[^/]+\/information$/,
  Activity: /\/groups\/[^/]+\/activity$/,
}

/**
 * Navigates to a specific tab in the group view
 */
export async function navigateToTab(page: Page, tab: GroupTab): Promise<void> {
  await page.getByRole('tab', { name: tab }).click()
  await page.waitForURL(TAB_URL_PATTERNS[tab])
}
