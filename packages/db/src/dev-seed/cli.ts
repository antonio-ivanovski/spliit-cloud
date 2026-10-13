import { parseArgs } from 'node:util'

import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'

import { PrismaClient } from '../generated/prisma/client/client'
import '../prisma-json'
import { buildScenarios, seedNamespace } from './fixtures'
import { seedDevelopmentData } from './seed'

const help = `Opt-in local development fixtures. Never runs during startup or migrations.

NODE_ENV=development bun seed:dev --account=<email-or-id> [--reset | --clean] [--dry-run]

Sign in once to create a local account, then supply its email or account ID.
Default: create missing demo groups; skip existing groups (including your edits).
--reset: replace only this account's seeded demo groups, discarding their edits.
--clean: delete only this account's seeded demo groups. Demo peer accounts remain.
--dry-run: print the scenario plan without connecting to or changing the database.

Requires NODE_ENV=development and an explicit loopback PostgreSQL DATABASE_URL.
For containers, run this command on the host using the mapped local database port.
`

async function main() {
  const { values } = parseArgs({
    options: {
      account: { type: 'string' },
      reset: { type: 'boolean' },
      clean: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(help)
    return
  }
  config({ path: new URL('../../../../.env', import.meta.url), quiet: true })
  if (process.env.NODE_ENV !== 'development')
    throw new Error(
      'Dev seed requires NODE_ENV=development; production, test, and unset modes are refused.',
    )
  if (!values.account?.trim())
    throw new Error(
      'Supply --account=<existing-local-email-or-id>. Use --help for instructions.',
    )
  if (values.reset && values.clean)
    throw new Error('Choose either --reset or --clean.')
  const action = values.clean ? 'clean' : values.reset ? 'reset' : 'seed'
  if (values['dry-run']) {
    const scenarios = buildScenarios(seedNamespace(values.account))
    console.log(
      `Plan: ${action}. No database connection; existing groups/account are not checked.`,
    )
    console.table(
      scenarios.map((scenario) => ({
        scenario: scenario.key,
        name: scenario.name || 'Friend: Alex Rivera',
        currency: scenario.currencyCode ?? scenario.currency,
        expenses: scenario.expenses.length,
        coverage: scenario.description,
      })),
    )
    return
  }
  if (!process.env.DATABASE_URL)
    throw new Error(
      'DATABASE_URL must be explicitly configured for the local development database.',
    )
  let url: URL
  try {
    url = new URL(process.env.DATABASE_URL)
  } catch {
    throw new Error('DATABASE_URL must be a valid loopback PostgreSQL URL.')
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error(
      'Dev seed only accepts a loopback PostgreSQL DATABASE_URL (localhost, 127.0.0.1, or ::1).',
    )
  // pg accepts connection options from URL query parameters, including host overrides.
  if (url.search)
    throw new Error(
      'Dev seed refuses DATABASE_URL query parameters; configure the local host, port, and database in the URL itself.',
    )
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
    }),
  })
  try {
    const account = await prisma.user.findFirst({
      where: {
        OR: [
          { id: values.account },
          { email: { equals: values.account, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true },
    })
    if (!account)
      throw new Error(
        'Account not found. Sign in to your local app once, then rerun with its email or account ID.',
      )
    const result = await prisma.$transaction(
      (tx) => seedDevelopmentData(tx, account, action),
      { timeout: 120000 },
    )
    if (action === 'clean')
      console.log(
        'Removed this account’s demo groups. Existing accounts and other groups are preserved.',
      )
    else {
      console.table(result)
      console.log(
        'Open /groups while signed in to the selected account. Refresh an already-open page.',
      )
      console.log(
        `Demo peer emails: ${seedNamespace(account.id)}-{1,2,3,4}@example.test (use local magic-link email delivery).`,
      )
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
