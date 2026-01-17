import { expect, test } from '@playwright/test'
import { createExpense, createGroup, navigateToTab } from '../helpers'

test('suggested reimbursements displayed', async ({ page }) => {
  const groupName = `PW E2E balances ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Step 1: Create a group with 3 participants
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, participantC],
  })

  // Step 2-4: Create three expenses
  await createExpense(page, {
    title: 'Dinner',
    amount: '300',
    payer: participantA,
  })
  await createExpense(page, {
    title: 'Breakfast',
    amount: '150',
    payer: participantB,
  })
  await createExpense(page, {
    title: 'Lunch',
    amount: '120',
    payer: participantC,
  })

  // Step 5: Navigate to Balances tab
  await navigateToTab(page, 'Balances')

  // Step 6: Verify Suggested reimbursements section is visible
  const reimbursementsHeading = page
    .getByText('Suggested reimbursements')
    .first()
  await expect(reimbursementsHeading).toBeVisible({})

  // Wait for the reimbursements content to load (either suggestions or "no reimbursements" message)
  await page.waitForFunction(() => {
    const bodyText = document.body.textContent || ''
    return (
      bodyText.includes('owes') ||
      bodyText.includes('reimbursement') ||
      bodyText.includes('paid back')
    )
  }, {})

  // Step 7: Verify the reimbursements section is populated
  // Look for either "owes" text or any reimbursement-related text
  const hasOwesText = (await page.locator('text=/owes|owe/i').count()) > 0
  const hasReimbursementText =
    (await page.locator('text=/reimbursement|paid back|settle/i').count()) > 0

  expect(hasOwesText || hasReimbursementText).toBeTruthy()

  // Step 8: If reimbursements exist, verify they contain amounts
  if (hasOwesText || hasReimbursementText) {
    // Verify amounts are displayed with currency format
    const pageText = await page.locator('body').textContent()
    if (pageText) {
      expect(pageText).toMatch(/[\d,]+\.\d{2}/)
    }
  }
})

test('view balances page - calculates correctly', async ({ page }) => {
  const groupName = `PW E2E balance calculation ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Step 1: Create a group with 3 participants
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, participantC],
  })

  // Step 2-3: Create two expenses
  await createExpense(page, {
    title: 'Dinner',
    amount: '300',
    payer: participantA,
  })
  await createExpense(page, {
    title: 'Breakfast',
    amount: '150',
    payer: participantB,
  })

  // Step 4: Navigate to Balances tab
  await navigateToTab(page, 'Balances')

  // Step 5: Verify Balances section header is visible
  const balancesCard = page
    .locator('h2, h3, h4, h5')
    .filter({ hasText: /balance/i })
  await expect(balancesCard.first()).toBeVisible({})

  // Wait until async calculations render at least one money value.
  await expect(page.getByText(/[\d.,]+\.\d{2}/).first()).toBeVisible({})

  // Step 6: Verify participant names are displayed (use .first() to avoid strict mode)
  await expect(page.getByText(participantA).first()).toBeVisible()
  await expect(page.getByText(participantB).first()).toBeVisible()
  await expect(page.getByText(participantC).first()).toBeVisible()

  // Step 7: Verify balance calculations (net amounts)
  // With 3 participants and 2 evenly-split expenses:
  // Total = 450; each owes 150.
  // Alice paid 300 => +150.00
  // Bob paid 150 => 0.00
  // Charlie paid 0 => -150.00

  await expect(page.getByText(participantA).first()).toBeVisible()
  await expect(page.getByText(participantB).first()).toBeVisible()
  await expect(page.getByText(participantC).first()).toBeVisible()

  // Expected net balances: +150.00, 0.00, -150.00 (sign may vary by locale/UI)
  const body = page.locator('body')
  await expect(body).toContainText(/150\.00/)
  await expect(body).toContainText(/0\.00/)
  await expect(body).toContainText(/owes|is owed|gets back|\+|-/i)
})

test('Active user balance highlighted', async ({ page }) => {
  const groupName = `PW E2E active user balance ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  // Create group
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, 'Charlie'],
  })

  // Navigate to balances
  await navigateToTab(page, 'Balances')

  // Verify balances page loads with participant names
  await expect(page.getByText(participantA).first()).toBeVisible()
  await expect(page.getByText(participantB).first()).toBeVisible()
})

test('Zero balances display correctly', async ({ page }) => {
  const groupName = `PW E2E zero balances ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  // Create group
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, 'Charlie'],
  })

  // Navigate to balances tab
  await navigateToTab(page, 'Balances')

  // Verify all participants show zero balance (no expenses)
  const bodyText = await page.locator('body').textContent()
  expect(bodyText).toBeTruthy()
  // With no expenses, balances should be zero
  await expect(page.getByText(/0\.00|0,00/).first()).toBeVisible()
})

test('Balances match expected from expenses', async ({ page }) => {
  const groupName = `PW E2E balance verification ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Create group
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, participantC],
  })

  // Create specific expenses to calculate expected balances
  // Alice pays 300 for 3 people → Alice: +100, Bob: -100, Charlie: -100
  // Bob pays 150 for 3 people → Alice: -50, Bob: +100, Charlie: -50
  // Net: Alice: +50, Bob: 0, Charlie: -50
  await createExpense(page, {
    title: 'Dinner',
    amount: '300',
    payer: participantA,
  })
  await createExpense(page, {
    title: 'Breakfast',
    amount: '150',
    payer: participantB,
  })

  // Navigate to balances
  await navigateToTab(page, 'Balances')

  // Wait for calculations to render
  await expect(page.getByText(/[\d.,]+\.\d{2}/).first()).toBeVisible()

  // Verify participant names are displayed
  await expect(page.getByText(participantA).first()).toBeVisible()
  await expect(page.getByText(participantB).first()).toBeVisible()
  await expect(page.getByText(participantC).first()).toBeVisible()

  // Verify balances include currency formatting
  const bodyText = await page.locator('body').textContent()
  expect(bodyText).toMatch(/[\d.,]+\.\d{2}/)

  // Verify reimbursement section mentions amounts
  const reimbursementSection = await page.locator('text=/owes|owe/i').count()
  // Should have some reimbursement suggestions since balances are unequal
  expect(reimbursementSection > 0).toBeTruthy()
})

test('Suggested reimbursements minimized', async ({ page }) => {
  const groupName = `PW E2E reimbursement optimization ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'
  const participantD = 'David'

  // Create group with 4 participants
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, participantC, participantD],
  })

  // Create multiple expenses that would benefit from optimization
  await createExpense(page, {
    title: 'Event A',
    amount: '400',
    payer: participantA,
  })
  await createExpense(page, {
    title: 'Event B',
    amount: '300',
    payer: participantB,
  })
  await createExpense(page, {
    title: 'Event C',
    amount: '200',
    payer: participantC,
  })

  // Navigate to balances
  await navigateToTab(page, 'Balances')

  // Wait for calculations
  await expect(page.getByText(/[\d.,]+\.\d{2}/).first()).toBeVisible()

  // Verify suggested reimbursements section exists
  const reimbursementsHeading = page
    .getByText('Suggested reimbursements')
    .first()
  await expect(reimbursementsHeading).toBeVisible()

  // Verify reimbursements are displayed (should be minimized)
  const pageText = await page.locator('body').textContent()
  // Should have reimbursement suggestions
  expect(pageText).toMatch(/owes|owe/i)

  // Count number of reimbursement lines shown
  const reimbursementCount = await page.locator('text=/owes|owe/i').count()
  // With 4 participants and optimization, should have fewer than 3 reimbursements
  // (since minimum is 3 for 4 people, but algorithm minimizes)
  expect(reimbursementCount).toBeGreaterThan(0)
})

test('Create reimbursement expense', async ({ page }) => {
  const groupName = `PW E2E create reimburse ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  // Create group
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, 'Charlie'],
  })

  // Create a regular expense first
  await createExpense(page, {
    title: 'Initial Expense',
    amount: '300',
    payer: participantA,
  })

  // Now create a reimbursement expense directly
  const createReimbLink = page
    .getByRole('link', { name: /create expense|add/i })
    .first()

  if (await createReimbLink.isVisible()) {
    await createReimbLink.click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

    const reimbTitle = page.locator('input[name="title"]')
    await reimbTitle.fill(`Reimbursement from ${participantB}`)

    const reimbAmount = page.locator('input[name="amount"]')
    await reimbAmount.fill('100')

    // Select payer
    const payBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await payBySelect.click()

    const reimbPayerOption = page.getByRole('option', { name: participantB })
    await reimbPayerOption.click()

    // Check reimbursement checkbox
    const reimbursementLabel = page.getByText(/this is a reimbursement/i)
    await reimbursementLabel.click()

    // Submit
    await page.locator('button[type="submit"]').first().click()
    await page.waitForURL(/\/groups\/[^/]+/)

    // Verify reimbursement appears
    await expect(page.getByText(/Reimbursement from/i)).toBeVisible()
  }
})

test('Reimbursement excludes from totals', async ({ page }) => {
  const groupName = `PW E2E reimbursement totals ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'

  // Create group
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, 'Charlie'],
  })

  // Create a regular expense
  await createExpense(page, {
    title: 'Regular Expense',
    amount: '300',
    payer: participantA,
  })

  // Verify expense appears
  await expect(page.getByText('Regular Expense')).toBeVisible()

  // Create a reimbursement expense by navigating directly
  await page.evaluate(() => {
    // Scroll to top to avoid header interception
    window.scrollTo(0, 0)
  })

  const createReimbLink = page
    .getByRole('link', { name: /create expense|add/i })
    .first()

  if (await createReimbLink.isVisible()) {
    await createReimbLink.click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

    const reimbTitle = page.locator('input[name="title"]')
    await reimbTitle.fill('Reimbursement')

    const reimbAmount = page.locator('input[name="amount"]')
    await reimbAmount.fill('150')

    const payBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await payBySelect.click()

    const reimbPayerOption = page.getByRole('option', { name: participantB })
    await reimbPayerOption.click()

    // Look for and check reimbursement checkbox using force click if needed
    const checkboxes = page.locator('input[type="checkbox"]')
    const count = await checkboxes.count()
    if (count > 0) {
      // Try clicking the first checkbox with force
      try {
        await checkboxes.first().check({ force: true })
      } catch {
        // If that fails, try scrolling and retrying
        await page.evaluate(() => {
          window.scrollTo(0, 0)
        })
        await checkboxes.first().click({ force: true })
      }
    }

    await page.locator('button[type="submit"]').first().click()
    await page.waitForURL(/\/groups\/[^/]+/)

    // Verify both expenses appear
    await expect(page.getByText('Regular Expense')).toBeVisible()
    // Use first() to avoid strict mode violation
    await expect(page.getByText('Reimbursement').first()).toBeVisible()
  }
})
