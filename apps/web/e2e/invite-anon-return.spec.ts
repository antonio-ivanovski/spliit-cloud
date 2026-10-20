import { expect, test } from '@playwright/test'

import {
  ANON_STORAGE_STATE,
  acknowledgeRecoveryLink,
  dismissUpdatesModal,
  submitProfileName,
  signOutAccount,
} from './helpers/auth'
import { uniqueId } from './helpers/data'
import {
  createInvitationContext,
  createInviteLink,
  expectJoined,
} from './helpers/invitations'

// Covers anonymous profile/recovery, root Strict Mode setup, and bounded auth bounces.
test('anonymous signup preserves invite proof until joining, then removes it without a routing loop', async ({
  browser,
}) => {
  const creator = await createInvitationContext(browser, {
    storageState: ANON_STORAGE_STATE,
  })
  const visitor = await createInvitationContext(browser)
  try {
    const creatorPage = await creator.newPage()
    await creatorPage.goto('/')
    await dismissUpdatesModal(creatorPage)
    const { groupId, inviteUrl } = await createInviteLink(
      creatorPage,
      uniqueId('Anonymous invite'),
      false,
    )
    const token = new URL(inviteUrl).searchParams.get('invite')
    expect(token).toMatch(/^[A-Za-z0-9_-]{16,}$/)

    const page = await visitor.newPage()
    const navigations: string[] = []
    const setupPosts: string[] = []
    const downloadWarnings: string[] = []
    const earlyCatalogs: string[] = []
    let setupAcknowledged = false
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url())
    })
    // Attach before signup: observing after the name save can miss setup entirely.
    page.on('request', (request) => {
      if (request.url().includes('groups.offlineCatalog') && !setupAcknowledged)
        earlyCatalogs.push(request.url())
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/auth/anonymous-recovery/setup'
      )
        setupPosts.push(request.url())
    })
    page.on('response', (response) => {
      if (
        response.url().includes('/auth/anonymous-recovery/acknowledge') &&
        response.ok()
      )
        setupAcknowledged = true
    })
    await page.exposeFunction('captureDownloadWarning', () =>
      downloadWarnings.push('Downloads need updating'),
    )
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.body?.textContent?.includes('Downloads need updating')) {
          void (
            window as unknown as { captureDownloadWarning: () => Promise<void> }
          ).captureDownloadWarning()
        }
      }).observe(document, { subtree: true, childList: true })
    })
    await page.goto(inviteUrl)
    await page.getByRole('button', { name: 'Sign in to accept' }).click()
    expect(new URL(page.url()).searchParams.getAll('invite')).toEqual([token])
    await page.getByRole('button', { name: 'Anonymous' }).click()
    await page.getByRole('button', { name: 'Create anonymous account' }).click()
    await submitProfileName(page, uniqueId('Guest'))
    const recoveryLink = await page.locator('input[readonly]').inputValue()
    await acknowledgeRecoveryLink(page)
    expect(setupPosts).toHaveLength(1)
    expect(earlyCatalogs).toEqual([])
    expect(downloadWarnings).toEqual([])
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/groups/${groupId}/expenses` &&
        !url.searchParams.has('invite'),
    )
    await expect(
      page.getByRole('button', { name: 'Add expense' }),
    ).toBeVisible()
    await expect(page.getByTestId('invitation-banner')).toBeHidden()
    await expect(
      page.getByTestId('invitation-already-member-banner'),
    ).toBeHidden()
    for (const navigation of navigations) {
      const values = new URL(navigation).searchParams.getAll('invite')
      if (values.length) expect(values).toEqual([token])
    }
    const settledUrl = page.url()
    // oxlint-disable-next-line spliit-e2e/no-wait-for-timeout -- explicit bounded observation of autonomous routing; this is the behavior under test, not a render wait.
    await page.waitForTimeout(3_000)
    expect(page.url()).toBe(settledUrl)
    expect(navigations.length).toBeLessThan(16)
    const recoveryInvite = await createInviteLink(
      creatorPage,
      uniqueId('Recovery invite'),
    )
    await signOutAccount(page, true)
    await page.goto(recoveryInvite.inviteUrl)
    await page.getByRole('button', { name: 'Sign in to accept' }).click()
    await page.getByRole('button', { name: 'Anonymous' }).click()
    await page.getByLabel('Sign in link', { exact: true }).fill(recoveryLink)
    await page
      .getByRole('button', { name: 'Sign in to anonymous account' })
      .click()
    await expectJoined(page, recoveryInvite.groupId)
  } finally {
    await visitor.close()
    await creator.close()
  }
})
