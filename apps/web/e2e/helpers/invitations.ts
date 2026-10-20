import type { Browser, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { E2E_API_URL } from '../../playwright.config'
import { createGroup } from './groups'

export async function createInviteLink(
  page: Page,
  name: string,
  shared = true,
) {
  const groupId = await createGroup(page, name)
  await page.getByRole('tab', { name: 'Invite link' }).click()
  if (shared) await page.getByRole('tab', { name: 'Multiple people' }).click()
  await page.getByRole('button', { name: 'Generate invite link' }).click()
  const field = page.locator('[data-testid="generated-invite-link"] input')
  await expect(field).toBeVisible()
  return { groupId, inviteUrl: await field.inputValue() }
}

export async function expectJoined(page: Page, groupId: string) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/groups/${groupId}/expenses` &&
      !url.searchParams.has('invite') &&
      !url.searchParams.has('invitationAction'),
  )
  await expect(page.getByRole('button', { name: 'Add expense' })).toBeVisible()
  await expect(page.getByTestId('invitation-banner')).toBeHidden()
  await expect(
    page.getByTestId('invitation-already-member-banner'),
  ).toBeHidden()
}

/**
 * Independent visitors need separate trusted-proxy identities on the shared
 * local API.
 */
export async function createInvitationContext(
  browser: Browser,
  options?: Parameters<Browser['newContext']>[0],
) {
  const context = await browser.newContext(options)
  const octets = crypto.getRandomValues(new Uint8Array(2))
  const address = `198.18.${octets[0]}.${octets[1]}`
  // Set at the network boundary to simulate the proxy without changing browser CORS requests.
  await context.route(`${E2E_API_URL}/**`, (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': address },
    }),
  )
  return context
}
