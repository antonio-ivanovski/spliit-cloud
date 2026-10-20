import { expect, test } from '@playwright/test'

import {
  ANON_STORAGE_STATE,
  dismissUpdatesModal,
  submitProfileName,
} from './helpers/auth'
import { uniqueEmail, uniqueId } from './helpers/data'
import {
  createInvitationContext,
  createInviteLink,
} from './helpers/invitations'
import { waitForEmailLink } from './maildev'

// Anonymous signup/recovery owns its journey in invite-anon-return.spec.ts.
// This journey protects emailed proof and the shared link's PENDING-after-join lifecycle.
test('magic-link signup through a shared invitation opens as a member and removes the credential', async ({
  browser,
}) => {
  const creatorContext = await createInvitationContext(browser, {
    storageState: ANON_STORAGE_STATE,
  })
  const guestContext = await createInvitationContext(browser)
  const callbackContext = await createInvitationContext(browser)
  try {
    const creator = await creatorContext.newPage()
    await creator.goto('/')
    await dismissUpdatesModal(creator)
    const groupName = uniqueId('Shared email invite')
    const { groupId, inviteUrl } = await createInviteLink(creator, groupName)
    const token = new URL(inviteUrl).searchParams.get('invite')
    expect(token).toBeTruthy()

    let guest = await guestContext.newPage()
    await guest.goto(inviteUrl)
    await guest.getByRole('button', { name: 'Sign in to accept' }).click()
    expect(new URL(guest.url()).searchParams.get('invite')).toBe(token)
    const email = uniqueEmail()
    await guest.getByLabel('Email').fill(email)
    await guest.getByRole('button', { name: 'Send sign-in link' }).click()
    await expect(
      guest.getByText('Check your inbox for a sign-in link.'),
    ).toBeVisible()
    const loginLink = await waitForEmailLink(email, '/auth/magic-link/verify')
    for (const key of ['callbackURL', 'newUserCallbackURL']) {
      const callback = new URL(loginLink).searchParams.get(key)
      expect(callback).toBeTruthy()
      expect(new URL(callback!).searchParams.getAll('invite')).toEqual([token])
      expect(new URL(callback!).searchParams.get('invitationAction')).toBe(
        'accept',
      )
    }
    guest = await callbackContext.newPage()
    await guest.goto(loginLink)
    await submitProfileName(guest, uniqueId('Email invitee'))
    await expect(guest).toHaveURL(
      (url) =>
        url.pathname === `/groups/${groupId}/expenses` &&
        !url.searchParams.has('invite'),
    )
    await expect(guest.getByRole('heading', { level: 1 })).toContainText(
      groupName,
    )
    await expect(
      guest.getByRole('button', { name: 'Add expense' }),
    ).toBeVisible()
    await expect(guest.getByTestId('invitation-banner')).toBeHidden()
    await expect(
      guest.getByTestId('invitation-already-member-banner'),
    ).toBeHidden()
    await guest.reload()
    await expect(
      guest.getByRole('button', { name: 'Add expense' }),
    ).toBeVisible()
  } finally {
    await callbackContext.close()
    await guestContext.close()
    await creatorContext.close()
  }
})
