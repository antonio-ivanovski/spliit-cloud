import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { prisma } from '@spliit/db'

import { app } from '../app'
import { randomId } from '../lib/api'
import { sendEmail } from '../lib/mail/send'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import {
  expectEmailEventually,
  getEmailForRecipient,
  probeMaildev,
} from './maildev-client'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()
const maildevReachable = await probeMaildev()

vi.mock(import('../lib/mail/send'), async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, sendEmail: vi.fn(mod.sendEmail) }
})

describe.skipIf(!maildevReachable)('SMTP auth flows — real MailDev', () => {
  const runId = testRunId()
  const accountIds: string[] = []
  const ledgerIds: string[] = []

  afterAll(async () => {
    await prisma.verification
      .deleteMany({ where: { identifier: { contains: runId } } })
      .catch(() => {})

    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }

    for (const aid of accountIds) {
      await prisma.account.delete({ where: { id: aid } }).catch(() => {})
    }
  })

  // ---------------------------------------------------------------------------
  // Group 1: Password reset — credential user
  // ---------------------------------------------------------------------------
  describe('password reset — credential user', () => {
    const email = `auth-${runId}@test-auth.example`
    const password = 'StrongP@ss123'

    it('sends "Reset your Spliit Cloud password" email and the reset link redirects', async () => {
      const signUpRes = await app.request('/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ email, password, name: 'SMTP Test' }),
      })
      expect(signUpRes.status).toBe(200)

      await expectEmailEventually({
        recipient: email,
        subject: 'Verify your Spliit Cloud account',
      })

      await prisma.account.update({
        where: { email },
        data: { emailVerified: true },
      })

      const signInRes = await app.request('/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ email, password }),
      })
      expect(signInRes.status).toBe(200)

      const acct = await prisma.account.findUnique({ where: { email } })
      if (acct) accountIds.push(acct.id)

      const forgotRes = await app.request('/auth/request-password-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          email,
          redirectTo: 'http://localhost:3000/reset-password',
        }),
      })
      expect(forgotRes.status).toBe(200)

      const captured = await expectEmailEventually({
        recipient: email,
        subject: 'Reset your Spliit Cloud password',
      })
      expect(captured!.text).toContain('/auth/reset-password')

      const urlMatch = captured!.text.match(
        /(https?:\/\/[^\s]+\/auth\/reset-password\/[^\s?]+\?[^\s]+)/,
      )
      expect(urlMatch).not.toBeNull()
      const resetUrl = urlMatch![1]

      const resetRes = await app.request(resetUrl, {
        method: 'GET',
        redirect: 'manual',
      })
      expect([200, 302, 307, 308]).toContain(resetRes.status)
    })
  })

  // ---------------------------------------------------------------------------
  // Group 2: Password reset — magic-link-only user
  // ---------------------------------------------------------------------------
  describe('password reset — magic-link-only user', () => {
    const mlEmail = `ml-${runId}@test-auth.example`
    const mlAccountId = `ml-acct-${runId}`

    beforeAll(async () => {
      await prisma.account.create({
        data: {
          id: mlAccountId,
          email: mlEmail,
          emailVerified: true,
          name: 'Magic Link User',
        },
      })
      accountIds.push(mlAccountId)
      await prisma.authIdentity.create({
        data: {
          id: `ml-id-${runId}`,
          providerId: 'magic-link',
          issuer: 'local:magic-link',
          accountId: mlEmail,
          userId: mlAccountId,
        },
      })
    })

    it('sends "Sign in to Spliit Cloud" email for users with only magic-link identity', async () => {
      const forgotRes = await app.request('/auth/request-password-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          email: mlEmail,
          redirectTo: 'http://localhost:3000/reset-password',
        }),
      })
      expect(forgotRes.status).toBe(200)

      const captured = await expectEmailEventually({
        recipient: mlEmail,
        subject: 'Sign in to Spliit Cloud',
      })
      expect(captured!.text).toContain('email sign-in link')
    })
  })

  // ---------------------------------------------------------------------------
  // Group 3: Email verification on sign-up
  // ---------------------------------------------------------------------------
  describe('email verification on sign-up', () => {
    const verifyEmail = `verify-${runId}@test-auth.example`
    const verifyPassword = 'VerifyStr0ng!'

    it('sends verification email and marks account verified when clicked', async () => {
      const signUpRes = await app.request('/auth/sign-up/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          email: verifyEmail,
          password: verifyPassword,
          name: 'Verify Test',
        }),
      })
      expect([200, 302, 307]).toContain(signUpRes.status)

      const acct = await prisma.account.findUnique({
        where: { email: verifyEmail },
      })
      expect(acct).not.toBeNull()
      accountIds.push(acct!.id)

      const captured = await expectEmailEventually({
        recipient: verifyEmail,
        subject: 'Verify your Spliit Cloud account',
      })
      expect(captured!.text).toContain('/auth/verify-email')

      expect(acct!.emailVerified).toBe(false)

      const urlMatch = captured!.text.match(
        /(https?:\/\/[^\s]+\/auth\/verify-email\?[^\s]+)/,
      )
      expect(urlMatch).not.toBeNull()
      const verifyUrl = urlMatch![1]

      const verifyRes = await app.request(verifyUrl, {
        method: 'GET',
        redirect: 'manual',
      })
      expect([200, 302, 307, 308]).toContain(verifyRes.status)

      const updated = await prisma.account.findUnique({
        where: { email: verifyEmail },
      })
      expect(updated!.emailVerified).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Group 4: Import flow sends invitation emails
  // ---------------------------------------------------------------------------
  describe('import flow sends invitation emails', () => {
    const impRunId = testRunId()
    const adminId = `admin-imp-${impRunId}`
    const adminEmail = `admin-imp-${impRunId}@test-auth.example`
    const invitee1Email = `invitee1-${impRunId}@test-auth.example`
    const invitee2Email = `invitee2-${impRunId}@test-auth.example`

    let groupId: string
    let adminLpId: string

    function makeCaller() {
      return groupsRouter.createCaller({
        auth: {
          session: { id: 'sess-imp' },
          user: {
            id: adminId,
            email: adminEmail,
            emailVerified: true,
            name: 'Import Admin',
          },
        },
      } as never)
    }

    beforeAll(async () => {
      await prisma.account.upsert({
        where: { email: adminEmail },
        update: {},
        create: {
          id: adminId,
          email: adminEmail,
          emailVerified: true,
          name: 'Import Admin',
        },
      })
      accountIds.push(adminId)

      const ledger = await prisma.ledger.create({
        data: { id: randomId(), currency: '$', currencyCode: 'USD' },
      })
      ledgerIds.push(ledger.id)

      const group = await prisma.group.create({
        data: {
          id: randomId(),
          name: `Import-Group-${impRunId}`,
          ledgerId: ledger.id,
        },
      })
      groupId = group.id

      const adminMember = await prisma.groupMember.create({
        data: {
          id: randomId(),
          groupId,
          accountId: adminId,
          role: 'ADMIN',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      })

      const adminLp = await prisma.ledgerParticipant.create({
        data: {
          id: randomId(),
          ledgerId: ledger.id,
          groupMemberId: adminMember.id,
        },
      })
      adminLpId = adminLp.id
    })

    it('sends invitation emails for each INVITE_BY_EMAIL participant mapping', async () => {
      const destLp1 = randomId()
      const destLp2 = randomId()

      const result = await makeCaller().import({
        requestId: crypto.randomUUID(),
        targetGroupId: groupId,
        participants: [
          {
            mode: 'LINK_EXISTING_PARTICIPANT',
            sourceName: 'Admin',
            destLedgerParticipantId: adminLpId,
          },
          {
            mode: 'INVITE_BY_EMAIL',
            sourceName: 'Friend One',
            email: invitee1Email,
            destLedgerParticipantId: destLp1,
          },
          {
            mode: 'INVITE_BY_EMAIL',
            sourceName: 'Friend Two',
            email: invitee2Email,
            destLedgerParticipantId: destLp2,
          },
        ],
        expenses: [
          {
            title: 'Dinner',
            amount: 3000,
            expenseDate: new Date('2026-06-15'),
            category: 'general',
            splitMode: 'EVENLY',
            paidBySplitMode: 'BY_AMOUNT',
            paidByList: [{ participant: destLp1, shares: 3000 }],
            paidFor: [
              { participant: destLp1, shares: 1 },
              { participant: adminLpId, shares: 1 },
            ],
            documents: [],
            recurrenceRule: 'NONE',
          },
        ],
        sourceMeta: {
          provider: 'SPLIIT',
          sourceGroupId: 'src-import-test',
        },
      })

      expect(result.invites).toHaveLength(2)

      for (const email of [invitee1Email, invitee2Email]) {
        const captured = await expectEmailEventually({
          recipient: email,
        })
        expect(captured!.text).toContain(`Import-Group-${impRunId}`)
        expect(captured!.text).toContain(
          'This invitation is part of an import from a Spliit export.',
        )
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Group 5: SMTP graceful degradation
// ---------------------------------------------------------------------------
describe.skipIf(!maildevReachable)('SMTP graceful degradation', () => {
  const g5runId = testRunId()
  const adminId = `g5-admin-${g5runId}`
  const adminEmail = `g5-admin-${g5runId}@test-auth.example`
  const inviteeEmail = `g5-invitee-${g5runId}@test-auth.example`

  const ledgerIds: string[] = []
  let groupId: string

  function makeCaller() {
    return invitationsRouter.createCaller({
      auth: {
        session: { id: 'sess-g5' },
        user: {
          id: adminId,
          email: adminEmail,
          emailVerified: true,
          name: 'G5 Admin',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    await prisma.account.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        id: adminId,
        email: adminEmail,
        emailVerified: true,
        name: 'G5 Admin',
      },
    })

    const ledger = await prisma.ledger.create({
      data: { id: randomId(), currency: '$', currencyCode: 'USD' },
    })
    ledgerIds.push(ledger.id)

    const group = await prisma.group.create({
      data: {
        id: randomId(),
        name: `G5-Group-${g5runId}`,
        ledgerId: ledger.id,
      },
    })
    groupId = group.id

    const adminMember = await prisma.groupMember.create({
      data: {
        id: randomId(),
        groupId,
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

    vi.mocked(sendEmail).mockRejectedValue(new Error('SMTP unreachable'))
  })

  afterAll(async () => {
    vi.mocked(sendEmail).mockRestore()

    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
  })

  beforeEach(async () => {
    vi.mocked(sendEmail).mockClear()
  })

  it('invitation creation succeeds gracefully when SMTP is unreachable', async () => {
    const result = await makeCaller().create({
      requestId: crypto.randomUUID(),
      groupId,
      email: inviteeEmail,
      role: 'MEMBER',
      temporaryName: 'G5 Invitee',
    })

    expect(result).toHaveProperty('invitationId')

    const invitation = await prisma.groupInvitation.findUnique({
      where: { id: result.invitationId },
    })
    expect(invitation).not.toBeNull()
    expect(invitation!.status).toBe('PENDING')
    expect(invitation!.email).toBe(inviteeEmail.toLowerCase())
    expect(invitation!.groupId).toBe(groupId)

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: inviteeEmail.toLowerCase() }),
    )
    const email = await getEmailForRecipient({ recipient: inviteeEmail })
    expect(email).toBeNull()
  })
})
