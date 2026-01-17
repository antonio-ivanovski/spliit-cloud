import { expect, type Page } from '@playwright/test'

/**
 * Creates a group with the specified name and participants
 * @returns The groupId extracted from the URL
 */
export async function createGroup({
  page,
  groupName,
  participants,
}: {
  page: Page
  groupName: string
  participants: string[]
}): Promise<string> {
  await page.goto('/groups')
  await page.getByRole('link', { name: 'Create' }).first().click()

  await page.getByLabel('Group name').fill(groupName)

  await fillParticipants(page, participants)

  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).not.toHaveURL(/\/groups\/create$/)
  await expect(page).toHaveURL(/\/groups\/[^/]+(\/expenses)?$/)

  const groupId = extractGroupId(page.url())
  return groupId
}

/**
 * Fills in participant inputs, adding more if needed
 */
export async function fillParticipants(
  page: Page,
  participants: string[],
): Promise<void> {
  const participantInputs = page.getByRole('textbox', { name: 'New' })

  for (let i = 0; i < participants.length; i++) {
    if (i >= 3) {
      await page.getByRole('button', { name: 'Add participant' }).click()
      await expect(participantInputs).toHaveCount(i + 1)
    }

    await participantInputs.nth(i).fill(participants[i]!)
  }
}

/**
 * Extracts the groupId from a group URL
 * @throws Error if groupId cannot be extracted
 */
export function extractGroupId(url: string): string {
  const groupId = url.match(/\/groups\/([^/]+)(?:\/expenses)?$/)?.[1]
  if (!groupId || groupId === 'create') {
    throw new Error(`Failed to extract groupId from URL: ${url}`)
  }
  return groupId
}
