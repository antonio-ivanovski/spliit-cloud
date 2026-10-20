import { expect, test } from '@playwright/test'

import {
  ANON_STORAGE_STATE,
  dismissUpdatesModal,
  submitProfileName,
  signOutAccount,
} from './helpers/auth'
import { TEST_PASSWORD, uniqueEmail, uniqueId } from './helpers/data'
import {
  createInvitationContext,
  createInviteLink,
  expectJoined,
} from './helpers/invitations'
import { waitForEmailLink } from './maildev'

test('password signup and later sign-in honor acceptance intent; opening a link while signed in only previews', async ({
  browser,
}) => {
  const creatorContext = await createInvitationContext(browser, {
    storageState: ANON_STORAGE_STATE,
  })
  const visitorContext = await createInvitationContext(browser)
  try {
    const creator = await creatorContext.newPage()
    await creator.goto('/')
    await dismissUpdatesModal(creator)
    const first = await createInviteLink(creator, uniqueId('Password signup'))
    const page = await visitorContext.newPage()
    await page.goto(first.inviteUrl)
    await page.getByRole('button', { name: 'Sign in to accept' }).click()
    await page.getByRole('tab', { name: 'Password' }).click()
    const email = uniqueEmail()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign up with password' }).click()
    await expect(
      page.getByText('Check your inbox to verify your account.'),
    ).toBeVisible()
    await page.goto(await waitForEmailLink(email, '/auth/verify-email'))
    await submitProfileName(page, uniqueId('Password guest'))
    await expectJoined(page, first.groupId)
    await dismissUpdatesModal(page)

    const second = await createInviteLink(creator, uniqueId('Password signin'))
    await page.goto(second.inviteUrl)
    await expect(page.getByTestId('invitation-banner')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Accept', exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('invitation-banner')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add expense' })).toBeHidden()

    await page.getByRole('button', { name: 'Accept', exact: true }).click()
    await expectJoined(page, second.groupId)
    const third = await createInviteLink(creator, uniqueId('Password return'))
    await signOutAccount(page)
    await page.goto(third.inviteUrl)
    await page.getByRole('button', { name: 'Sign in to accept' }).click()
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('tab', { name: 'Password' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in with password' }).click()
    await expectJoined(page, third.groupId)
    await page.reload()
    await expectJoined(page, third.groupId)
  } finally {
    await visitorContext.close()
    await creatorContext.close()
  }
})

test('passkey sign-in carries explicit acceptance after a preview', async ({
  browser,
}) => {
  const creatorContext = await createInvitationContext(browser, {
    storageState: ANON_STORAGE_STATE,
  })
  const visitorContext = await createInvitationContext(browser)
  try {
    const creator = await creatorContext.newPage()
    await creator.goto('/')
    await dismissUpdatesModal(creator)
    const invite = await createInviteLink(creator, uniqueId('Passkey invite'))
    const page = await visitorContext.newPage()
    const cdp = await visitorContext.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Anonymous' }).click()
    await page.getByRole('button', { name: 'Create anonymous account' }).click()
    await submitProfileName(page, uniqueId('Passkey guest'))
    await page.getByRole('radio', { name: /passkey/i }).click()
    await page
      .getByRole('button', { name: 'Add a passkey', exact: true })
      .click()
    await expect(page).toHaveURL((url) => url.pathname === '/')
    await dismissUpdatesModal(page)
    await signOutAccount(page, true)
    await page.goto(invite.inviteUrl)
    await page.getByRole('button', { name: 'Sign in to accept' }).click()
    await page.getByRole('button', { name: /^Sign in with passkey/ }).click()
    await expectJoined(page, invite.groupId)
  } finally {
    await visitorContext.close()
    await creatorContext.close()
  }
})
