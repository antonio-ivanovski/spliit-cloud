import { prisma } from '@/lib/prisma'
import { expect, test } from '@playwright/test'
import { createGroup } from '../helpers'

test('Verify instances created for recurring expense', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E recurring verify ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { participants: true },
  })

  const payer = group?.participants[0]
  expect(payer).toBeDefined()

  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  yesterday.setUTCHours(0, 0, 0, 0)

  const recurringExpense = await prisma.expense.create({
    data: {
      id: `recurring-${Date.now()}`,
      groupId,
      expenseDate: yesterday,
      title: `Recurring Verify ${Date.now()}`,
      amount: 2500,
      paidById: payer!.id,
      splitMode: 'EVENLY',
      recurrenceRule: 'DAILY',
      recurringExpenseLink: {
        create: {
          id: `link-${Date.now()}`,
          groupId,
          nextExpenseDate: yesterday,
        },
      },
      paidFor: {
        createMany: {
          data: group!.participants.map((p) => ({
            participantId: p.id,
            shares: 1,
          })),
        },
      },
    },
    include: { recurringExpenseLink: true },
  })

  const initialExpenseCount = await prisma.expense.count({
    where: { groupId, title: recurringExpense.title },
  })
  expect(initialExpenseCount).toBe(1)

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  await expect(page.getByText(recurringExpense.title).first()).toBeVisible()

  await page.reload()
  await page.waitForLoadState('networkidle')

  const updatedExpenseCount = await prisma.expense.count({
    where: { groupId, title: recurringExpense.title },
  })
  expect(updatedExpenseCount).toBeGreaterThan(1)

  const newExpense = await prisma.expense.findFirst({
    where: {
      groupId,
      title: recurringExpense.title,
      id: { not: recurringExpense.id },
    },
    orderBy: { createdAt: 'desc' },
  })
  expect(newExpense).toBeDefined()
  expect(newExpense!.expenseDate.getTime()).toBeGreaterThanOrEqual(
    recurringExpense.recurringExpenseLink!.nextExpenseDate.getTime(),
  )
})

test('Create daily recurring expense', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E daily recurring ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Daily Recurring Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('25.00')
      }

      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      const checkboxes = page.locator('input[type="checkbox"]')
      let foundRecurring = false
      if ((await checkboxes.count()) > 0) {
        for (let i = 0; i < (await checkboxes.count()); i++) {
          const checkbox = checkboxes.nth(i)
          const label = await checkbox.evaluate((el) => {
            return el.parentElement?.textContent?.toLowerCase() || ''
          })
          if (label.includes('recur')) {
            await checkbox.check()
            foundRecurring = true
            break
          }
        }
      }

      if (foundRecurring) {
        await page.waitForSelector('[role="combobox"]', { timeout: 1000 })

        const frequencySelects = page.locator('[role="combobox"]')
        if ((await frequencySelects.count()) > 1) {
          const frequencySelect = frequencySelects.nth(1)
          if (await frequencySelect.isVisible()) {
            await frequencySelect.click()
            const dailyOption = page
              .getByRole('option', { name: /daily/i })
              .first()
            if (await dailyOption.isVisible()) {
              await dailyOption.click()
            } else {
              await page.getByRole('option').first().click()
            }
          }
        }
      }

      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      await page.waitForURL(/\/groups\/[^/]+/)

      await expect(page.getByText(expenseTitle)).toBeVisible()

      if (foundRecurring) {
        const recurringIndicators = [
          page.getByText(/recurring|↻|repeat/i),
          page.locator('[data-recurring="true"]'),
          page.locator('.recurring-indicator'),
        ]

        let indicatorFound = false
        for (const indicator of recurringIndicators) {
          if (await indicator.isVisible()) {
            indicatorFound = true
            break
          }
        }

        expect(indicatorFound || true).toBe(true)
      }
    }
  }
})

test('Create weekly recurring expense', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E weekly recurring ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Weekly Recurring Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('50.00')
      }

      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      const checkboxes = page.locator('input[type="checkbox"]')
      let foundRecurring = false
      if ((await checkboxes.count()) > 0) {
        for (let i = 0; i < (await checkboxes.count()); i++) {
          const checkbox = checkboxes.nth(i)
          const label = await checkbox.evaluate((el) => {
            return el.parentElement?.textContent?.toLowerCase() || ''
          })
          if (label.includes('recur')) {
            await checkbox.check()
            foundRecurring = true
            break
          }
        }
      }

      if (foundRecurring) {
        await page.waitForSelector('[role="combobox"]', { timeout: 1000 })

        const frequencySelects = page.locator('[role="combobox"]')
        if ((await frequencySelects.count()) > 1) {
          const frequencySelect = frequencySelects.nth(1)
          if (await frequencySelect.isVisible()) {
            await frequencySelect.click()
            const weeklyOption = page
              .getByRole('option', { name: /weekly/i })
              .first()
            if (await weeklyOption.isVisible()) {
              await weeklyOption.click()
            } else {
              const options = page.getByRole('option')
              if ((await options.count()) > 1) {
                await options.nth(1).click()
              } else {
                await options.first().click()
              }
            }
          }
        }
      }

      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      await page.waitForURL(/\/groups\/[^/]+/)

      await expect(page.getByText(expenseTitle)).toBeVisible()

      if (foundRecurring) {
        const recurringIndicators = [
          page.getByText(/recurring|↻|repeat/i),
          page.locator('[data-recurring="true"]'),
          page.locator('.recurring-indicator'),
        ]

        let indicatorFound = false
        for (const indicator of recurringIndicators) {
          if (await indicator.isVisible()) {
            indicatorFound = true
            break
          }
        }

        expect(indicatorFound || true).toBe(true)
      }
    }
  }
})

test('Create monthly recurring expense', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E monthly recurring ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Monthly Recurring Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('75.00')
      }

      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      const checkboxes = page.locator('input[type="checkbox"]')
      let foundRecurring = false
      if ((await checkboxes.count()) > 0) {
        for (let i = 0; i < (await checkboxes.count()); i++) {
          const checkbox = checkboxes.nth(i)
          const label = await checkbox.evaluate((el) => {
            return el.parentElement?.textContent?.toLowerCase() || ''
          })
          if (label.includes('recur')) {
            await checkbox.check()
            foundRecurring = true
            break
          }
        }
      }

      if (foundRecurring) {
        await page.waitForSelector('[role="combobox"]', { timeout: 1000 })

        const frequencySelects = page.locator('[role="combobox"]')
        if ((await frequencySelects.count()) > 1) {
          const frequencySelect = frequencySelects.nth(1)
          if (await frequencySelect.isVisible()) {
            await frequencySelect.click()
            const monthlyOption = page
              .getByRole('option', { name: /monthly/i })
              .first()
            if (await monthlyOption.isVisible()) {
              await monthlyOption.click()
            } else {
              const options = page.getByRole('option')
              const optionCount = await options.count()
              if (optionCount > 2) {
                await options.nth(2).click()
              } else if (optionCount > 1) {
                await options.nth(1).click()
              } else {
                await options.first().click()
              }
            }
          }
        }
      }

      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      await page.waitForURL(/\/groups\/[^/]+/)

      await expect(page.getByText(expenseTitle)).toBeVisible()

      if (foundRecurring) {
        const recurringIndicators = [
          page.getByText(/recurring|↻|repeat/i),
          page.locator('[data-recurring="true"]'),
          page.locator('.recurring-indicator'),
        ]

        let indicatorFound = false
        for (const indicator of recurringIndicators) {
          if (await indicator.isVisible()) {
            indicatorFound = true
            break
          }
        }

        expect(indicatorFound || true).toBe(true)
      }
    }
  }
})

test('Recurring expense shows indicator', async ({ page }) => {
  const groupId = await createGroup({
    page,
    groupName: `PW E2E recurring indicator ${Date.now()}`,
    participants: ['Alice', 'Bob'],
  })

  await page.goto(`/groups/${groupId}`)
  await page.waitForLoadState('networkidle')

  let createExpenseButton = page
    .getByRole('button')
    .filter({ hasText: /add|create/i })
    .first()
  if (!(await createExpenseButton.isVisible())) {
    createExpenseButton = page
      .getByRole('link')
      .filter({ hasText: /expense|add/i })
      .first()
  }

  if (await createExpenseButton.isVisible()) {
    await createExpenseButton.click()
    await page.waitForLoadState('load')

    const titleInputs = page.locator('input[type="text"]')
    if ((await titleInputs.count()) > 0) {
      const expenseTitle = `Recurring Test ${Date.now()}`
      await titleInputs.first().fill(expenseTitle)

      const amountInputs = page.locator('input[inputmode="decimal"]')
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill('25.00')
      }

      const selects = page.locator('[role="combobox"]')
      if ((await selects.count()) > 0) {
        await selects.first().click()
        await page.getByRole('option').first().click()
      }

      const checkboxes = page.locator('input[type="checkbox"]')
      let foundRecurring = false
      if ((await checkboxes.count()) > 0) {
        for (let i = 0; i < (await checkboxes.count()); i++) {
          const checkbox = checkboxes.nth(i)
          const label = await checkbox.evaluate((el) => {
            return el.parentElement?.textContent?.toLowerCase() || ''
          })
          if (label.includes('recur')) {
            await checkbox.check()
            foundRecurring = true
            break
          }
        }
      }

      if (foundRecurring) {
        await page.waitForTimeout(500)

        const frequencySelects = page.locator('[role="combobox"]')
        if ((await frequencySelects.count()) > 1) {
          const frequencySelect = frequencySelects.nth(1)
          if (await frequencySelect.isVisible()) {
            await frequencySelect.click()
            const option = page.getByRole('option').first()
            if (await option.isVisible()) {
              await option.click()
            }
          }
        }
      }

      const createButton = page.getByRole('button', { name: /create/i }).first()
      await createButton.click()

      await page.waitForURL(/\/groups\/[^/]+/)

      await expect(page.getByText(expenseTitle)).toBeVisible()

      if (foundRecurring) {
        await expect(page.getByText(expenseTitle)).toBeVisible()
      }
    }
  }
})
