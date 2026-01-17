import { expect, test } from '@playwright/test'
import * as fs from 'fs'
import { createExpense, createGroup } from '../helpers'

interface ExpenseData {
  title?: string
  Description?: string
  amount?: string
  Cost?: string
  paidBy?: string
  date?: string
  Date?: string
  [key: string]: unknown
}

test.describe('Export functionality', () => {
  test('Export JSON download', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E export JSON ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await createExpense(page, {
      title: 'Dinner',
      amount: '50.00',
      payer: 'Alice',
    })

    await page
      .getByRole('button', { name: /export/i })
      .first()
      .click()

    const jsonOption = page.getByRole('menuitem', { name: /json/i })
    await expect(jsonOption).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await jsonOption.click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.json$/)

    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()

    const content = fs.readFileSync(downloadPath!, 'utf-8')
    const data = JSON.parse(content) as Record<string, unknown>

    const rawExpenses = data.expenses as ExpenseData[] | undefined
    const expenses = Array.isArray(rawExpenses) ? rawExpenses : []
    expect(Array.isArray(expenses)).toBe(true)
    expect(expenses.length).toBeGreaterThan(0)

    const dinnerExpense = expenses.find((e) =>
      String(e.title || e.Description || '').includes('Dinner'),
    )
    expect(dinnerExpense).toBeDefined()

    const amount = String(dinnerExpense?.amount || dinnerExpense?.Cost || '')
    expect(amount).toContain('50')
  })

  test('Export JSON content', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E export content ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await createExpense(page, {
      title: 'Lunch',
      amount: '25.50',
      payer: 'Alice',
    })
    await createExpense(page, {
      title: 'Coffee',
      amount: '5.00',
      payer: 'Bob',
    })

    await page
      .getByRole('button', { name: /export/i })
      .first()
      .click()

    const jsonOption = page.getByRole('menuitem', { name: /json/i })
    await expect(jsonOption).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await jsonOption.click()
    const download = await downloadPromise

    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()

    const content = fs.readFileSync(downloadPath!, 'utf-8')
    const data = JSON.parse(content) as Record<string, unknown>

    const rawExpenses = data.expenses as ExpenseData[] | undefined
    const expenses = Array.isArray(rawExpenses) ? rawExpenses : []
    expect(Array.isArray(expenses)).toBe(true)
    expect(expenses.length).toBe(2)

    const titles = expenses.map((e) => String(e.title || e.Description || ''))
    expect(titles).toContain('Lunch')
    expect(titles).toContain('Coffee')
  })

  test('Export CSV download', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E export CSV ${Date.now()}`,
      participants: ['Alice', 'Bob'],
    })

    await createExpense(page, {
      title: 'Groceries',
      amount: '100.00',
      payer: 'Bob',
    })

    await page
      .getByRole('button', { name: /export/i })
      .first()
      .click()

    const csvOption = page.getByRole('menuitem', { name: /csv/i })
    await expect(csvOption).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await csvOption.click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.csv$/)

    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()

    const content = fs.readFileSync(downloadPath!, 'utf-8')
    expect(content.length).toBeGreaterThan(0)

    const lines = content.trim().split('\n')
    expect(lines.length).toBeGreaterThan(1)

    expect(lines[0]).toContain('Description')
    expect(lines[0]).toContain('Cost')
  })

  test('Export CSV format', async ({ page }) => {
    const groupId = await createGroup({
      page,
      groupName: `PW E2E CSV format ${Date.now()}`,
      participants: ['Alice', 'Bob', 'Charlie'],
    })

    const expenseTitle = 'Weekend Trip'
    await createExpense(page, {
      title: expenseTitle,
      amount: '300.00',
      payer: 'Alice',
    })

    await page
      .getByRole('button', { name: /export/i })
      .first()
      .click()

    const csvOption = page.getByRole('menuitem', { name: /csv/i })
    await expect(csvOption).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await csvOption.click()
    const download = await downloadPromise

    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()

    const content = fs.readFileSync(downloadPath!, 'utf-8')
    const lines = content.trim().split('\n')

    expect(lines[0]).toContain('Description')
    expect(lines[0]).toContain('Cost')
    expect(lines[0]).toContain('Date')

    const dataRow = lines.find((line) => line.includes(expenseTitle))
    expect(dataRow).toBeDefined()
    expect(dataRow).toContain('300')
  })
})
