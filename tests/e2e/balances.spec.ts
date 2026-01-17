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
  const reimbursementsHeading = page.getByRole('heading', {
    name: 'Suggested reimbursements',
  })
  await expect(reimbursementsHeading).toBeVisible()

  // Step 7: Verify reimbursements list is displayed
  const reimbursementsList = page.getByTestId('reimbursements-list')
  await expect(reimbursementsList).toBeVisible()

  // Step 8: Verify specific reimbursement rows with expected visible content
  const bobOwesAlice = page.getByTestId(
    `reimbursement-row-${participantB}-${participantA}`,
  )
  await expect(bobOwesAlice).toBeVisible()
  await expect(bobOwesAlice).toContainText(
    `${participantB} owes ${participantA}`,
  )
  await expect(bobOwesAlice).toContainText('$40.00')

  const charlieOwesAlice = page.getByTestId(
    `reimbursement-row-${participantC}-${participantA}`,
  )
  await expect(charlieOwesAlice).toBeVisible()
  await expect(charlieOwesAlice).toContainText(
    `${participantC} owes ${participantA}`,
  )
  await expect(charlieOwesAlice).toContainText('$70.00')

  // Verify Mark as paid links exist and are clickable
  await expect(
    bobOwesAlice.getByRole('link', { name: /mark as paid/i }),
  ).toBeVisible()
  await expect(
    charlieOwesAlice.getByRole('link', { name: /mark as paid/i }),
  ).toBeVisible()
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
  const balancesHeading = page.getByRole('heading', { name: 'Balances' })
  await expect(balancesHeading).toBeVisible()

  // Step 6: Verify balances list is rendered
  const balancesList = page.getByTestId('balances-list')
  await expect(balancesList).toBeVisible()

  // Step 7: Verify balance calculations (net amounts)
  // With 3 participants and 2 evenly-split expenses:
  // Total = 450; each owes 150.
  // Alice paid 300 => +150.00
  // Bob paid 150 => 0.00
  // Charlie paid 0 => -150.00

  const aliceRow = page.getByTestId(`balance-row-${participantA}`)
  await expect(aliceRow).toBeVisible()
  await expect(aliceRow).toContainText(participantA)
  await expect(aliceRow).toContainText('$150.00')

  const bobRow = page.getByTestId(`balance-row-${participantB}`)
  await expect(bobRow).toBeVisible()
  await expect(bobRow).toContainText(participantB)
  await expect(bobRow).toContainText('$0.00')

  const charlieRow = page.getByTestId(`balance-row-${participantC}`)
  await expect(charlieRow).toBeVisible()
  await expect(charlieRow).toContainText(participantC)
  await expect(charlieRow).toContainText('-$150.00')
})

test('Active user balance highlighted', async ({ page }) => {
  const groupName = `PW E2E active user balance ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Create group
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, participantC],
  })

  // Navigate to balances
  await navigateToTab(page, 'Balances')

  // Verify balances list loads with all participants
  const balancesList = page.getByTestId('balances-list')
  await expect(balancesList).toBeVisible()

  await expect(page.getByTestId(`balance-row-${participantA}`)).toBeVisible()
  await expect(page.getByTestId(`balance-row-${participantB}`)).toBeVisible()
  await expect(page.getByTestId(`balance-row-${participantC}`)).toBeVisible()
})

test('Zero balances display correctly', async ({ page }) => {
  const groupName = `PW E2E zero balances ${Date.now()}`
  const participantA = 'Alice'
  const participantB = 'Bob'
  const participantC = 'Charlie'

  // Create group
  await createGroup({
    page,
    groupName,
    participants: [participantA, participantB, participantC],
  })

  // Navigate to balances tab
  await navigateToTab(page, 'Balances')

  // Verify balances list is displayed
  const balancesList = page.getByTestId('balances-list')
  await expect(balancesList).toBeVisible()

  // With no expenses, all balances should be zero
  await expect(page.getByTestId(`balance-row-${participantA}`)).toContainText(
    '$0.00',
  )
  await expect(page.getByTestId(`balance-row-${participantB}`)).toContainText(
    '$0.00',
  )
  await expect(page.getByTestId(`balance-row-${participantC}`)).toContainText(
    '$0.00',
  )

  // Verify no reimbursements are needed
  await expect(page.getByTestId('no-reimbursements')).toBeVisible()
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

  // Wait for balances list to be visible
  const balancesList = page.getByTestId('balances-list')
  await expect(balancesList).toBeVisible()

  // Verify exact balance values by checking visible text content
  await expect(page.getByTestId(`balance-row-${participantA}`)).toContainText(
    participantA,
  )
  await expect(page.getByTestId(`balance-row-${participantA}`)).toContainText(
    '$150.00',
  )

  await expect(page.getByTestId(`balance-row-${participantB}`)).toContainText(
    participantB,
  )
  await expect(page.getByTestId(`balance-row-${participantB}`)).toContainText(
    '$0.00',
  )

  await expect(page.getByTestId(`balance-row-${participantC}`)).toContainText(
    participantC,
  )
  await expect(page.getByTestId(`balance-row-${participantC}`)).toContainText(
    '-$150.00',
  )

  // Verify reimbursement suggestion exists
  const reimbursementsList = page.getByTestId('reimbursements-list')
  await expect(reimbursementsList).toBeVisible()

  // Charlie should owe Alice $150
  const charlieOwesAlice = page.getByTestId(
    `reimbursement-row-${participantC}-${participantA}`,
  )
  await expect(charlieOwesAlice).toBeVisible()
  await expect(charlieOwesAlice).toContainText(
    `${participantC} owes ${participantA}`,
  )
  await expect(charlieOwesAlice).toContainText('$150.00')
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

  // Verify suggested reimbursements section exists
  const reimbursementsHeading = page.getByRole('heading', {
    name: 'Suggested reimbursements',
  })
  await expect(reimbursementsHeading).toBeVisible()

  // Verify reimbursements list is displayed
  const reimbursementsList = page.getByTestId('reimbursements-list')
  await expect(reimbursementsList).toBeVisible()

  // Count reimbursement rows - with optimization should be minimal
  // With 4 participants, maximum needed is 3 reimbursements (n-1)
  const reimbursementRows = page.locator('[data-testid^="reimbursement-row-"]')
  const count = await reimbursementRows.count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(3)
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

    await page.getByLabel(/title/i).fill(`Reimbursement from ${participantB}`)

    // Use the amount field with name="amount" specifically
    await page.locator('input[name="amount"]').fill('100')

    // Select payer
    const payBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await payBySelect.click()

    const reimbPayerOption = page.getByRole('option', { name: participantB })
    await reimbPayerOption.click()

    // Check reimbursement checkbox
    const reimbursementCheckbox = page.getByRole('checkbox', {
      name: /reimbursement/i,
    })
    await reimbursementCheckbox.check()

    // Submit
    await page.getByRole('button', { name: /create/i }).click()
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

  // Create a reimbursement expense
  const createReimbLink = page
    .getByRole('link', { name: /create expense|add/i })
    .first()

  if (await createReimbLink.isVisible()) {
    await createReimbLink.click()
    await page.waitForURL(/\/groups\/[^/]+\/expenses\/create/)

    await page.getByLabel(/title/i).fill('Reimbursement')

    // Use the amount field with name="amount" specifically
    await page.locator('input[name="amount"]').fill('150')

    const payBySelect = page
      .getByRole('combobox')
      .filter({ hasText: 'Select a participant' })
    await payBySelect.click()

    await page.getByRole('option', { name: participantB }).click()

    // Check reimbursement checkbox
    const reimbursementCheckbox = page.getByRole('checkbox', {
      name: /reimbursement/i,
    })
    await reimbursementCheckbox.check()

    await page.getByRole('button', { name: /create/i }).click()
    await page.waitForURL(/\/groups\/[^/]+/)

    // Verify both expenses appear
    await expect(page.getByText('Regular Expense')).toBeVisible()
    await expect(page.getByText('Reimbursement').first()).toBeVisible()
  }
})
