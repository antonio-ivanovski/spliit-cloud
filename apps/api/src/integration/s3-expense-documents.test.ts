import { prisma } from '@spliit/db'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { randomId } from '../lib/api'
import { appRouter } from '../trpc/routers/_app'
import { groupsRouter } from '../trpc/routers/groups'
import {
  getObjectBody,
  listObjects,
  objectExists,
  probeMaxIO,
} from './maxio-client'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const maxioReachable = await probeMaxIO()

describe.skipIf(!maxioReachable)('S3 expense documents — real MaxIO', () => {
  const password = 'TestPass123!'

  const trackedAccountIds: string[] = []
  const trackedLedgerIds: string[] = []

  function trackLedger(id: string) {
    trackedLedgerIds.push(id)
  }

  function trackAccount(id: string) {
    trackedAccountIds.push(id)
  }

  /**
   * Sign up or sign in via the app's auth endpoints.
   * Returns the session cookie and account ID.
   */
  async function createSession(
    email: string,
  ): Promise<{ cookie: string; accountId: string }> {
    const authHeaders = {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    }

    // Try sign-in first; might work if account was already verified
    let res = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email, password }),
    })

    if (res.ok) {
      // Account already exists and is verified
      const account = await prisma.account.findUnique({ where: { email } })
      const setCookie = res.headers.get('set-cookie') ?? ''
      const sessionMatch = setCookie.match(
        /better-auth\.session_token=([^;,]+)/,
      )
      const cookie = sessionMatch
        ? `better-auth.session_token=${sessionMatch[1]}`
        : ''
      if (account) trackAccount(account.id)
      return { cookie, accountId: account?.id ?? '' }
    }

    // Sign up (creates Account + AuthIdentity with password hash)
    res = await app.request('/auth/sign-up/email', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email, password, name: 'S3 Test User' }),
    })
    const signUpData = (await res.json()) as { user?: { id: string } }
    const accountId = signUpData.user?.id ?? ''
    trackAccount(accountId)

    // Mark verified
    await prisma.account.update({
      where: { email },
      data: { emailVerified: true },
    })

    // Sign in now that email is verified
    res = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      throw new Error(`Failed to sign in after verification (${res.status})`)
    }

    const setCookie = res.headers.get('set-cookie') ?? ''
    const sessionMatch = setCookie.match(/better-auth\.session_token=([^;,]+)/)
    const cookie = sessionMatch
      ? `better-auth.session_token=${sessionMatch[1]}`
      : ''
    return { cookie, accountId }
  }

  function makeCaller(accountId: string, email: string) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: `sess-${randomId()}` },
        user: {
          id: accountId,
          email,
          emailVerified: true,
          name: 'S3 Test Admin',
        },
      },
    } as never)
  }

  // Build a caller for the full app router so tests can hit the
  // `uploads.presign` mutation directly. Pass `null` for `accountId`
  // to simulate an unauthenticated request (the protectedProcedure
  // will reject with UNAUTHORIZED).
  function makeUploadsCaller(accountId: string | null, email?: string) {
    return appRouter.createCaller(
      accountId
        ? ({
            auth: {
              session: { id: `sess-${randomId()}` },
              user: {
                id: accountId,
                email: email ?? '',
                emailVerified: true,
                name: 'S3 Test Admin',
              },
            },
          } as never)
        : ({ auth: null } as never),
    )
  }

  async function createGroup(
    name: string,
    adminId: string,
    adminEmail: string,
  ): Promise<{ groupId: string; ledgerId: string; participantId: string }> {
    const caller = makeCaller(adminId, adminEmail)
    const { groupId } = await caller.create({
      groupFormValues: {
        name,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group!.ledger.id)
    return {
      groupId,
      ledgerId: group!.ledger.id,
      participantId: group!.members[0].ledgerParticipant!.id,
    }
  }

  afterAll(async () => {
    for (const aid of trackedAccountIds) {
      await prisma.session
        .deleteMany({ where: { userId: aid } })
        .catch(() => {})
      await prisma.authIdentity
        .deleteMany({ where: { userId: aid } })
        .catch(() => {})
    }

    for (const lid of trackedLedgerIds) {
      await prisma.expenseDocument
        .deleteMany({ where: { ledgerId: lid } })
        .catch(() => {})
    }

    for (const lid of trackedLedgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }

    for (const aid of trackedAccountIds) {
      await prisma.account.delete({ where: { id: aid } }).catch(() => {})
    }
  })

  // -------------------------------------------------------------------
  // Group 1: Full upload-and-attach lifecycle
  // -------------------------------------------------------------------
  it('1a-1d: full upload-and-attach lifecycle', async () => {
    const runId = testRunId()
    const email = `s3-${runId}@test.example`

    const { cookie, accountId } = await createSession(email)
    expect(cookie).not.toBe('')

    const { groupId, ledgerId, participantId } = await createGroup(
      `Lifecycle-${runId}`,
      accountId,
      email,
    )
    const caller = makeCaller(accountId, email)

    // 1a — Presign upload URL & PUT bytes
    const presignData = await makeUploadsCaller(
      accountId,
      email,
    ).uploads.presign({
      ledgerId,
      fileName: 'receipt.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
    })
    expect(presignData.key).toMatch(/^tmp\//)

    const content = Buffer.from('fake-jpeg-test-content')
    const putRes = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: content,
    })
    expect(putRes.ok).toBe(true)

    // 1b — Create expense with the document & verify S3 state
    const docId = randomId()
    const { expenseId } = await caller.expenses.create({
      groupId,
      expense: {
        title: 'Receipt',
        amount: 2000,
        paidByList: [{ participant: participantId, shares: 2000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [
          { id: docId, url: presignData.fileUrl, width: 100, height: 100 },
        ],
        recurrenceRule: 'NONE',
      },
    })

    const dbDoc = await prisma.expenseDocument.findFirst({
      where: { expenseId },
    })
    expect(dbDoc).not.toBeNull()

    const promotedKey = presignData.key.replace('tmp/', 'documents/')
    const docKeys = await listObjects('documents/')
    expect(docKeys).toContain(promotedKey)

    // Promotion should have removed the tmp/ source
    expect(await objectExists(presignData.key)).toBe(false)

    // 1c — Read back bytes match
    const body = await getObjectBody(promotedKey)
    expect(body).toBe('fake-jpeg-test-content')

    // 1d — Delete expense & verify cleanup
    await caller.expenses.delete({ groupId, expenseId })

    expect(await objectExists(promotedKey)).toBe(false)

    const dbDocAfterDelete = await prisma.expenseDocument.findFirst({
      where: { expenseId },
    })
    expect(dbDocAfterDelete).toBeNull()
  })

  // -------------------------------------------------------------------
  // Group 2: Cascade delete of all group documents on deleteGroup
  // -------------------------------------------------------------------
  it('2: cascade delete of all group documents on deleteGroup', async () => {
    const runId = testRunId()
    const email = `s3-cascade-${runId}@test.example`

    const { cookie, accountId } = await createSession(email)
    expect(cookie).not.toBe('')

    const { groupId, ledgerId, participantId } = await createGroup(
      `Cascade-${runId}`,
      accountId,
      email,
    )
    const caller = makeCaller(accountId, email)

    const promotedKeys: string[] = []
    for (let i = 0; i < 3; i++) {
      const { uploadUrl, fileUrl, key } = await makeUploadsCaller(
        accountId,
        email,
      ).uploads.presign({
        ledgerId,
        fileName: `doc-${i}.jpg`,
        contentType: 'image/jpeg',
        fileSize: 512,
      })
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: Buffer.from(`doc-${i}-content`),
      })

      promotedKeys.push(key.replace(/^tmp\//, 'documents/'))

      await caller.expenses.create({
        groupId,
        expense: {
          title: `Expense ${i}`,
          amount: 1000,
          paidByList: [{ participant: participantId, shares: 1000 }],
          paidBySplitMode: 'BY_AMOUNT',
          isMultiPayer: false,
          paidFor: [{ participant: participantId, shares: 1 }],
          category: 'general',
          splitMode: 'EVENLY',
          expenseDate: new Date().toISOString(),
          isReimbursement: false,
          documents: [
            { id: randomId(), url: fileUrl, width: 200, height: 200 },
          ],
          recurrenceRule: 'NONE',
        },
      })
    }

    // Verify each document exists rather than asserting the total count
    // to avoid flaky failures when other tests write to the same bucket.
    for (const key of promotedKeys) {
      expect(await objectExists(key)).toBe(true)
    }

    // Delete the group — deleteGroup enumerates ledger documents and
    // deletes each S3 object, then deletes the group row.
    await caller.delete({ groupId })

    for (const key of promotedKeys) {
      expect(await objectExists(key)).toBe(false)
    }
  })

  // -------------------------------------------------------------------
  // Group 3: Document swap on updateExpense
  // -------------------------------------------------------------------
  it('3: document swap on updateExpense', async () => {
    const runId = testRunId()
    const email = `s3-swap-${runId}@test.example`

    const { cookie, accountId } = await createSession(email)
    expect(cookie).not.toBe('')

    const { groupId, ledgerId, participantId } = await createGroup(
      `Swap-${runId}`,
      accountId,
      email,
    )
    const caller = makeCaller(accountId, email)

    // Upload A
    const {
      uploadUrl: uploadUrlA,
      fileUrl: fileUrlA,
      key: tmpKeyA,
    } = await makeUploadsCaller(accountId, email).uploads.presign({
      ledgerId,
      fileName: 'a.jpg',
      contentType: 'image/jpeg',
      fileSize: 512,
    })
    await fetch(uploadUrlA, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from('content-a'),
    })

    // Upload B
    const {
      uploadUrl: uploadUrlB,
      fileUrl: fileUrlB,
      key: tmpKeyB,
    } = await makeUploadsCaller(accountId, email).uploads.presign({
      ledgerId,
      fileName: 'b.jpg',
      contentType: 'image/jpeg',
      fileSize: 512,
    })
    await fetch(uploadUrlB, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from('content-b'),
    })

    // Create expense with A, B
    const docIdA = randomId()
    const docIdB = randomId()
    const { expenseId } = await caller.expenses.create({
      groupId,
      expense: {
        title: 'Swap Test',
        amount: 3000,
        paidByList: [{ participant: participantId, shares: 3000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [
          { id: docIdA, url: fileUrlA, width: 100, height: 100 },
          { id: docIdB, url: fileUrlB, width: 200, height: 200 },
        ],
        recurrenceRule: 'NONE',
      },
    })

    const docKeyA = tmpKeyA.replace(/^tmp\//, 'documents/')
    const docKeyB = tmpKeyB.replace(/^tmp\//, 'documents/')
    expect(await objectExists(docKeyA)).toBe(true)
    expect(await objectExists(docKeyB)).toBe(true)
    // Promotion removed tmp/ sources
    expect(await objectExists(tmpKeyA)).toBe(false)
    expect(await objectExists(tmpKeyB)).toBe(false)

    // Upload A' (replacement for A)
    const {
      uploadUrl: uploadUrlAprime,
      fileUrl: fileUrlAprime,
      key: tmpKeyAprime,
    } = await makeUploadsCaller(accountId, email).uploads.presign({
      ledgerId,
      fileName: 'a-prime.jpg',
      contentType: 'image/jpeg',
      fileSize: 512,
    })
    await fetch(uploadUrlAprime, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from('content-a-prime'),
    })

    // Update expense — keep only A' (new id, new url), dropping A and B
    const docIdAprime = randomId()
    await caller.expenses.update({
      groupId,
      expenseId,
      expense: {
        title: 'Swap Test',
        amount: 3000,
        paidByList: [{ participant: participantId, shares: 3000 }],
        paidBySplitMode: 'BY_AMOUNT',
        isMultiPayer: false,
        paidFor: [{ participant: participantId, shares: 1 }],
        category: 'general',
        splitMode: 'EVENLY',
        expenseDate: new Date().toISOString(),
        isReimbursement: false,
        documents: [
          { id: docIdAprime, url: fileUrlAprime, width: 150, height: 150 },
        ],
        recurrenceRule: 'NONE',
      },
    })

    const docKeyAprime = tmpKeyAprime.replace(/^tmp\//, 'documents/')
    const docKeysAfterUpdate = await listObjects('documents/')
    expect(docKeysAfterUpdate).toContain(docKeyAprime)
    // Old documents A and B should be gone after the swap
    expect(await objectExists(docKeyA)).toBe(false)
    expect(await objectExists(docKeyB)).toBe(false)
    // Promotion removed tmp/ source
    expect(await objectExists(tmpKeyAprime)).toBe(false)

    const docsAfterUpdate = await prisma.expenseDocument.findMany({
      where: { expenseId },
    })
    expect(docsAfterUpdate.length).toBe(1)
    expect(docsAfterUpdate[0].id).toBe(docIdAprime)

    await caller.expenses.delete({ groupId, expenseId })
  })

  // -------------------------------------------------------------------
  // Group 4: Presigned URL auth edge cases
  // -------------------------------------------------------------------
  it('4a: presign — no auth returns UNAUTHORIZED', async () => {
    await expect(
      makeUploadsCaller(null).uploads.presign({
        ledgerId: 'some-ledger',
        fileName: 'test.jpg',
        contentType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    })
  })

  it('4b: presign — empty body (no ledgerId) returns BAD_REQUEST', async () => {
    const runId = testRunId()
    const email = `s4b-${runId}@test.example`

    const { accountId } = await createSession(email)

    // The new tRPC mutation validates `ledgerId` with Zod (.min(1))
    // before the resolver runs, so an empty string is rejected as a
    // validation error rather than as the Hono helper's "Missing
    // ledgerId" message. We assert on the validation error shape.
    await expect(
      makeUploadsCaller(accountId, email).uploads.presign({
        ledgerId: '',
        fileName: 'test.jpg',
        contentType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('4c: presign — fileSize > 2MB returns BAD_REQUEST', async () => {
    const runId = testRunId()
    const email = `s4c-${runId}@test.example`

    const { accountId } = await createSession(email)

    const { ledgerId } = await createGroup(`Auth4c-${runId}`, accountId, email)

    await expect(
      makeUploadsCaller(accountId, email).uploads.presign({
        ledgerId,
        fileName: 'large.jpg',
        contentType: 'image/jpeg',
        fileSize: 2 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/exceeds the maximum upload size/i),
    })
  })

  it('4d: presign — non-member returns FORBIDDEN', async () => {
    const runId = testRunId()
    const emailA = `s4d-a-${runId}@test.example`

    const { accountId: accountIdA } = await createSession(emailA)
    const { ledgerId } = await createGroup(
      `Auth4d-${runId}`,
      accountIdA,
      emailA,
    )

    // User B signs in but is not a member
    const emailB = `s4d-b-${runId}@test.example`
    const { accountId: accountIdB } = await createSession(emailB)

    await expect(
      makeUploadsCaller(accountIdB, emailB).uploads.presign({
        ledgerId,
        fileName: 'test.jpg',
        contentType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringMatching(/not authorized/i),
    })
  })

  it('4e: presign — valid cookie + member returns a callable URL', async () => {
    const runId = testRunId()
    const email = `s4e-${runId}@test.example`

    const { accountId } = await createSession(email)

    const { ledgerId } = await createGroup(`Auth4e-${runId}`, accountId, email)

    const data = await makeUploadsCaller(accountId, email).uploads.presign({
      ledgerId,
      fileName: 'test.jpg',
      contentType: 'image/jpeg',
      fileSize: 512,
    })
    expect(data).toHaveProperty('uploadUrl')
    expect(data).toHaveProperty('fileUrl')
    expect(data).toHaveProperty('key')
    expect(data.key).toMatch(/^tmp\//)

    const putRes = await fetch(data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from('test-content'),
    })
    expect(putRes.ok).toBe(true)

    expect(await objectExists(data.key)).toBe(true)
  })
})
