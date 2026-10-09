import { expect, test } from '@playwright/test'

import { ANON_STORAGE_STATE } from './helpers/auth'
import { uniqueId } from './helpers/data'
import { createExpense } from './helpers/expenses'
import { createGroup } from './helpers/groups'

test.use({ storageState: ANON_STORAGE_STATE })

async function openExpensePreview(
  page: Parameters<typeof createExpense>[0],
  title: string,
) {
  await page
    .getByTestId(/expense-item-/)
    .filter({ hasText: title })
    .first()
    .getByRole('link')
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test.describe('expense edit and delete @critical', () => {
  test('edit an expense title', async ({ page }) => {
    const groupId = await createGroup(page, uniqueId('Edit flow'))
    const title = uniqueId('Original')
    await createExpense(page, groupId, title, '10')
    await openExpensePreview(page, title)

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Edit expense' })
      .click()
    await expect(page).toHaveURL(/\/edit/)
    // The form populates from the expense query; editing before it settles
    // risks a form reset wiping the new value on data arrival.
    await expect(
      page.getByPlaceholder('Monday evening restaurant'),
    ).toHaveValue(title)

    const updated = uniqueId('Updated')
    await page.getByPlaceholder('Monday evening restaurant').fill(updated)
    // Exact match: the split-preset cards on this form carry their own
    // "Save as preset" buttons.
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    // Saving lands on the expense detail view, not the list.
    await expect(page).toHaveURL(
      new RegExp(`/groups/${groupId}/expenses/[^/]+$`),
    )
    await expect(page.getByText(updated).first()).toBeVisible()
    await expect(page.getByText(title)).toBeHidden()
  })

  test('delete an expense', async ({ page }) => {
    const groupId = await createGroup(page, uniqueId('Delete flow'))
    const title = uniqueId('Doomed')
    await createExpense(page, groupId, title, '10')
    await openExpensePreview(page, title)

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Edit expense' })
      .click()
    await expect(page).toHaveURL(/\/edit/)
    // The form populates from the expense query; opening Delete before it
    // settles renders the plain confirm (no title yet) and the flip to typed
    // mode on data arrival can drop the dialog. Sync on the loaded title.
    await expect(
      page.getByPlaceholder('Monday evening restaurant'),
    ).toHaveValue(title)

    await page.getByRole('button', { name: 'Delete' }).click()
    const dialog = page.getByRole('dialog', {
      name: 'Delete this expense?',
    })
    await expect(dialog).toBeVisible()
    // Fresh accounts default to typed delete-confirmation: the title must be
    // retyped before the destructive action enables (button reads "Delete"
    // in this mode, "Yes" only for plain confirmation). Typing flips the
    // button from disabled to enabled, which re-renders it — sync on enabled
    // first so the click resolves against the fresh element, not a detached
    // handle.
    await dialog.getByRole('textbox').fill(title)
    const confirmDelete = dialog.getByRole('button', { name: 'Delete' })
    await expect(confirmDelete).toBeEnabled()
    await confirmDelete.click()

    await expect(page).toHaveURL(
      new RegExp(`/groups/${groupId}/expenses(\\?|$)`),
    )
    await expect(page.getByText(title)).toBeHidden()
  })
})
