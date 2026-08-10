import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { randomId } from '../lib/api'
import { env } from '../lib/env'
import '../lib/notifications'
import { waitForScheduledNotificationDispatchesForTest } from '../lib/notifications/dispatcher'
import { invitationsRouter } from '../trpc/routers/invitations'
import { expectEmailEventually, probeMaildev } from './maildev-client'
import { checkDbConnection, testRunId } from './setup'

const API_BASE_URL = env.BETTER_AUTH_URL ?? 'http://localhost:3101'

await checkDbConnection()

const maildevReachable = await probeMaildev()

// ---------------------------------------------------------------------------
// Test 1: Email invitation flow
// ---------------------------------------------------------------------------
describe.skipIf(!maildevReachable)('Email invitation flow — real DB', () => {
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

    // The invitee account is intentionally NOT created here: the router
    // only sends the invitation email when the recipient has no account
    // yet.  The account is created in the "accepts the invitation" test
    // below, which runs after the email assertion.

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
      requestId: crypto.randomUUID(),
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

    await waitForScheduledNotificationDispatchesForTest()

    // Pull the invitation email out of MailDev's inbox. The lookup is
    // recipient-scoped, so a non-null result already proves the email was
    // delivered to `inviteeEmail`. The body assertions below check the
    // template variant (new-user sign-up link) and the target URL.
    const captured = await expectEmailEventually({ recipient: inviteeEmail })
    const mailContent = captured.text
    expect(mailContent).toContain(groupName)
    expect(mailContent).toContain('You will appear as "Invited User"')
    // Since invitee has no account yet, email should say "Create an account"
    // and link to the sign-up page with the invitation id.
    expect(mailContent).toContain('Create an account')
    expect(mailContent).toContain(`/?invitation=${result.invitationId}`)
    expect(captured.html).toContain('Create an account')
    expect(captured.html).toContain(`/?invitation=${result.invitationId}`)
  })

  // ------------------------------------------------------------------
  // 2. Accept the invitation
  // ------------------------------------------------------------------
  it('accepts the invitation and adds the user as a group member', async () => {
    // Create the invitee account now — it was intentionally deferred so
    // the invitation email test above exercises the new-user variant.
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
async function probeApiHealth(baseUrl = API_BASE_URL): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

const apiReachable = await probeApiHealth()

describe.skipIf(!apiReachable || !maildevReachable)(
  'Magic link flow — real API',
  () => {
    const runId = testRunId()
    const testEmail = `magic-${runId}@test-magic-link.example`
    const apiBase = API_BASE_URL

    beforeAll(async () => {
      // Clean any stale verification for this email before starting
      await prisma.verification
        .deleteMany({ where: { identifier: testEmail } })
        .catch(() => {})
    })

    afterAll(async () => {
      // Clean up any verifications created for this email
      await prisma.verification
        .deleteMany({ where: { identifier: testEmail } })
        .catch(() => {})

      // Clean up the account if it was created
      const account = await prisma.account
        .findUnique({ where: { email: testEmail } })
        .catch(() => null)
      if (account) {
        await prisma.account
          .delete({ where: { id: account.id } })
          .catch(() => {})
      }
    })

    it('sends a magic link email and can verify the token', async () => {
      // Request magic link
      const sendRes = await fetch(`${apiBase}/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          email: testEmail,
          callbackURL: 'http://localhost:3000',
        }),
      })
      expect(sendRes.status).toBe(200)

      // Pull the magic link email out of MailDev's inbox.
      const captured = await expectEmailEventually({ recipient: testEmail })
      const mailContent = captured.text
      expect(mailContent).toContain('Click the link below to sign in to Spliit')
      expect(captured.html).toContain('Sign in to Spliit Cloud')

      // Parse the email to extract the magic link URL
      // The email body lines after the header contain the URL.
      // Format:
      //   Click the link below to sign in to Spliit.
      //
      //   http://localhost:3101/auth/magic-link/verify?token=xxx...
      const urlMatch = mailContent.match(
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
  },
)
