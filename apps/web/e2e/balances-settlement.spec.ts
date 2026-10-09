import { expect, test } from '@playwright/test'

import { ANON_STORAGE_STATE } from './helpers/auth'
import { uniqueId } from './helpers/data'
import { createExpense } from './helpers/expenses'
import { createGroup } from './helpers/groups'

test.use({ storageState: ANON_STORAGE_STATE })

async function addUnlinkedParticipant(
  page: Parameters<typeof createGroup>[0],
  groupId: string,
  name: string,
) {
  await page.goto(`/groups/${groupId}/members`)
  await page.getByRole('tab', { name: 'No account' }).click()
  // Exact match: the invite-link tab behind this page carries its own
  // "Temporary name (optional)" field.
  await page.getByLabel('Temporary name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Add participant' }).click()
  await expect(page.getByText(name).first()).toBeVisible()
}

test.describe('balances and settlements', () => {
  test('unbalanced expense suggests a settlement', async ({ page }) => {
    const groupId = await createGroup(page, uniqueId('Settlement club'))
    await addUnlinkedParticipant(page, groupId, uniqueId('Roommate'))
    await createExpense(page, groupId, uniqueId('Rent'), '100')

    await page.goto(`/groups/${groupId}/balances`)
    await expect(page.getByText('Suggested payments')).toBeVisible()
    await expect(page.getByTestId(/^settlement-settle-/).first()).toBeVisible()
  })

  test('recording a settlement settles the group up @critical', async ({
    page,
  }) => {
    const groupId = await createGroup(page, uniqueId('Settle up'))
    await addUnlinkedParticipant(page, groupId, uniqueId('Partner'))
    await createExpense(page, groupId, uniqueId('Groceries'), '60')

    await page.goto(`/groups/${groupId}/balances`)
    await page
      .getByTestId(/^settlement-settle-/)
      .first()
      .click()

    const createButton = page.getByTestId('settlement-create')
    await expect(createButton).toBeVisible()
    await createButton.click()

    await expect(page.getByText('Settled up').first()).toBeVisible()
  })
})
