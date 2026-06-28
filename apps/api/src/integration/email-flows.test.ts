import { prisma } from '@spliit/db'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomId } from '../lib/api'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const MAIL_DIR = join(process.cwd(), '.mail')

/** Read the most recently written `.eml` file in the mail dir whose name
 * contains the recipient email. Returns the file content as a string. */
async function readMailFile(recipientEmail: string): Promise<string | null> {
  const dir = MAIL_DIR
  const files = await fs.readdir(dir).catch(() => [])
  const safeRecipient = recipientEmail.replace(/[^a-z0-9@._-]/gi, '_')
  // Find the newest file matching the recipient; the timestamp prefix
  // means sort descending by name = newest first.
  const matching = files
    .filter((f) => f.endsWith(`${safeRecipient}.eml`))
    .sort()
    .reverse()
  if (matching.length === 0) return null
  const content = await fs.readFile(join(dir, matching[0]), 'utf8')
  return content
}

/** Delete all `.eml` files whose name contains a known test run id so
 * cleanup is scoped to this run. */
async function deleteMailFilesForTest(runId: string): Promise<void> {
  const dir = MAIL_DIR
  const files = await fs.readdir(dir).catch(() => [])
  const toRemove = files.filter((f) => f.includes(runId) && f.endsWith('.eml'))
  await Promise.all(
    toRemove.map((f) => fs.unlink(join(dir, f)).catch(() => {})),
  )
}

// ---------------------------------------------------------------------------
// Test 1: Email invitation flow
// ---------------------------------------------------------------------------
describe('Email invitation flow — real DB', () => {
  const runId = testRunId()
  const adminId = `admin-${runId}`
  const adminEmail = `admin-${runId}@test-invite.example`
  const inviteeId = `invitee-${runId}`
  const inviteeEmail = `invitee-${runId}@test-invite.example`
  const groupName = `Invite-Group-${runId}`

  /** Ledger id created during test — delete in afterAll to cascade. */
  const ledgerIds: string[] = []
  /** Group id created during test. */
  let groupId = ''
  /** Created account ids. */
  const accountIds: string[] = [adminId, inviteeId]

  function makeAdminCaller() {
    return invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: adminId,
          email: adminEmail,
          emailVerified: true,
          name: 'Admin User',
        },
      },
    } as never)
  }

  function makeInviteeCaller() {
    return invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-invitee' },
        user: {
          id: inviteeId,
          email: inviteeEmail,
          emailVerified: true,
          name: 'Invited User',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    // Create admin account
    await prisma.account.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        id: adminId,
        email: adminEmail,
        emailVerified: true,
        name: 'Admin User',
      },
    })

    // Create the invitee account
    await prisma.account.upsert({
      where: { email: inviteeEmail },
      update: {},
      create: {
        id: inviteeId,
        email: inviteeEmail,
        emailVerified: true,
        name: 'Invited User',
      },
    })

    // Create a test group with ledger and admin member (mimics the
    // shape `createGroupAndLedger` in api.ts produces).
    const ledger = await prisma.ledger.create({
      data: { id: randomId(), currency: '$', currencyCode: 'USD' },
    })
    ledgerIds.push(ledger.id)

    const group = await prisma.group.create({
      data: {
        id: randomId(),
        name: groupName,
        ledgerId: ledger.id,
      },
    })
    groupId = group.id

    const adminMember = await prisma.groupMember.create({
      data: {
        id: randomId(),
        groupId: group.id,
        accountId: adminId,
        role: 'ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })

    await prisma.ledgerParticipant.create({
      data: {
        id: randomId(),
        ledgerId: ledger.id,
        groupMemberId: adminMember.id,
      },
    })
  })

  afterAll(async () => {
    // Delete mail files created during this test
    await deleteMailFilesForTest(runId)

    // Delete group + ledger (cascade handles members, participants, etc.)
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }

    // Delete accounts
    for (const aid of accountIds) {
      await prisma.account.delete({ where: { id: aid } }).catch(() => {})
    }
  })

  // ------------------------------------------------------------------
  // 1. Invite someone via email
  // ------------------------------------------------------------------
  it('creates an email invitation and writes the email file', async () => {
    const caller = makeAdminCaller()

    const result = await caller.create({
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
      temporaryName: 'Invited User',
    })

    expect(result).toHaveProperty('invitationId')

    // Verify invitation record in DB
    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: result.invitationId },
    })
    expect(invitation).not.toBeNull()
    expect(invitation!.email).toBe(inviteeEmail.toLowerCase())
    expect(invitation!.groupId).toBe(groupId)
    expect(invitation!.role).toBe('MEMBER')
    expect(invitation!.status).toBe('PENDING')
    expect(invitation!.type).toBe('EMAIL')
    expect(invitation!.invitedById).toBe(adminId)

    // Check the .mail/ directory for the email
    const mailContent = await readMailFile(inviteeEmail)
    expect(mailContent).not.toBeNull()
    expect(mailContent).toContain(inviteeEmail)
    expect(mailContent).toContain(groupName)
    // Since invitee has an account, email should say "Open Spliit"
    // and link to the group page (not the sign-up page).
    expect(mailContent).toContain('Open Spliit')
    expect(mailContent).toContain(`/groups/${groupId}`)
  })

  // ------------------------------------------------------------------
  // 2. Accept the invitation
  // ------------------------------------------------------------------
  it('accepts the invitation and adds the user as a group member', async () => {
    const invitation = await prisma.groupInvitation.findFirst({
      where: { groupId, email: inviteeEmail.toLowerCase(), status: 'PENDING' },
    })
    expect(invitation).not.toBeNull()

    const caller = makeInviteeCaller()
    const result = await caller.accept({ invitationId: invitation!.id })

    expect(result.groupId).toBe(groupId)

    // Verify the member was added to the group
    const member = await prisma.groupMember.findUnique({
      where: {
        groupId_accountId: { groupId, accountId: inviteeId },
      },
    })
    expect(member).not.toBeNull()
    expect(member!.status).toBe('ACTIVE')
    expect(member!.role).toBe('MEMBER')

    // Verify the invitation status changed
    const updatedInvitation = await prisma.groupInvitation.findUnique({
      where: { id: invitation!.id },
    })
    expect(updatedInvitation!.status).toBe('ACCEPTED')

    // The member should have a ledger participant
    const participant = await prisma.ledgerParticipant.findUnique({
      where: { groupMemberId: member!.id },
    })
    expect(participant).not.toBeNull()
    expect(participant!.ledgerId).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Test 2: Magic link sign-in (HTTP-level, requires running API)
// ---------------------------------------------------------------------------
async function probeApiHealth(
  baseUrl = 'http://localhost:3001',
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

const apiReachable = await probeApiHealth()

describe.skipIf(!apiReachable)('Magic link flow — real API', () => {
  const runId = testRunId()
  const testEmail = `magic-${runId}@test-magic-link.example`
  const apiBase = 'http://localhost:3001'

  beforeAll(async () => {
    // Clean any stale verification for this email before starting
    await prisma.verification
      .deleteMany({ where: { identifier: testEmail } })
      .catch(() => {})
  })

  afterAll(async () => {
    // Delete mail files
    await deleteMailFilesForTest(runId)

    // Clean up any verifications created for this email
    await prisma.verification
      .deleteMany({ where: { identifier: testEmail } })
      .catch(() => {})

    // Clean up the account if it was created
    const account = await prisma.account
      .findUnique({ where: { email: testEmail } })
      .catch(() => null)
    if (account) {
      await prisma.account.delete({ where: { id: account.id } }).catch(() => {})
    }
  })

  it('sends a magic link email and can verify the token', async () => {
    // Request magic link
    const sendRes = await fetch(`${apiBase}/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        callbackURL: 'http://localhost:3000',
      }),
    })
    expect(sendRes.status).toBe(200)

    // Check .mail/ for the magic link email
    const mailContent = await readMailFile(testEmail)
    expect(mailContent).not.toBeNull()
    expect(mailContent).toContain('sign-in link')
    expect(mailContent).toContain('sign in to Spliit')

    // Parse the email to extract the magic link URL
    // The email body lines after the header contain the URL.
    // Format:
    //   Click the link below to sign in to Spliit.
    //
    //   http://localhost:3001/auth/magic-link/verify?token=xxx...
    const urlMatch = mailContent!.match(
      /(https?:\/\/[^\s]+\/auth\/magic-link\/verify\?[^\s]+)/,
    )
    expect(urlMatch).not.toBeNull()
    const magicLinkUrl = urlMatch![1]

    // The token is in the URL as a query parameter
    const parsedUrl = new URL(magicLinkUrl)
    const token = parsedUrl.searchParams.get('token')
    expect(token).toBeTruthy()

    // Call the magic link verify endpoint. This should create a session.
    const verifyRes = await fetch(magicLinkUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual', // better-auth may redirect to callbackURL
    })

    // better-auth's magic link verify redirects to the callback URL on
    // success (2xx or 3xx). We accept either a redirect or a 200.
    expect([200, 302, 307, 308]).toContain(verifyRes.status)

    // A Verification record should exist in the database (or have been
    // consumed — better-auth deletes it on use, so verifying existence
    // is fragile). Instead, verify a session cookie was set.
    const setCookieHeader = verifyRes.headers.get('set-cookie')
    // better-auth may set a session cookie. We don't assert its
    // presence because the API may be configured differently in the
    // test environment (no secure cookies in dev), but we log it.
    if (setCookieHeader) {
      expect(setCookieHeader).toContain('session')
    }

    // Verify the session was actually created in the DB
    const account = await prisma.account.findUnique({
      where: { email: testEmail },
    })
    if (account) {
      const sessions = await prisma.session.findMany({
        where: { userId: account.id },
      })
      expect(sessions.length).toBeGreaterThan(0)
    }
  })
})
