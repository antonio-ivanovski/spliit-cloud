import { prisma } from '@spliit/db'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { randomId } from '../lib/api'
import { groupsRouter } from '../trpc/routers/groups'
import {
  clearBucket,
  getObjectBody,
  listObjects,
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

  beforeEach(async () => {
    await clearBucket()
  })

  afterAll(async () => {
    await clearBucket()

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
    const presignRes = await app.request('/uploads/presign', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        ledgerId,
        fileName: 'receipt.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024,
      }),
    })
    expect(presignRes.status).toBe(200)
    const presignData = (await presignRes.json()) as {
      uploadUrl: string
      fileUrl: string
      key: string
    }
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
        saveDefaultSplittingOptions: false,
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

    const tmpKeys = await listObjects('tmp/')
    expect(tmpKeys.length).toBe(0)

    // 1c — Read back bytes match
    const body = await getObjectBody(promotedKey)
    expect(body).toBe('fake-jpeg-test-content')

    // 1d — Delete expense & verify cleanup
    await caller.expenses.delete({ groupId, expenseId })

    const afterDelete = await listObjects('documents/')
    expect(afterDelete.length).toBe(0)

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

    for (let i = 0; i < 3; i++) {
      const presignRes = await app.request('/uploads/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          ledgerId,
          fileName: `doc-${i}.jpg`,
          contentType: 'image/jpeg',
          fileSize: 512,
        }),
      })
      const { uploadUrl, fileUrl } = (await presignRes.json()) as {
        uploadUrl: string
        fileUrl: string
        key: string
      }
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: Buffer.from(`doc-${i}-content`),
      })

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
          saveDefaultSplittingOptions: false,
          documents: [
            { id: randomId(), url: fileUrl, width: 200, height: 200 },
          ],
          recurrenceRule: 'NONE',
        },
      })
    }

    const docKeys = await listObjects('documents/')
    expect(docKeys.length).toBe(3)

    // Delete the group — deleteGroup enumerates ledger documents and
    // deletes each S3 object, then deletes the group row.
    await caller.delete({ groupId })

    const allKeys = await listObjects()
    expect(allKeys.length).toBe(0)
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
    const presignA = await app.request('/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        ledgerId,
        fileName: 'a.jpg',
        contentType: 'image/jpeg',
        fileSize: 512,
      }),
    })
    const { uploadUrl: uploadUrlA, fileUrl: fileUrlA } =
      (await presignA.json()) as {
        uploadUrl: string
        fileUrl: string
        key: string
      }
    await fetch(uploadUrlA, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from('content-a'),
    })

    // Upload B
    const presignB = await app.request('/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        ledgerId,
        fileName: 'b.jpg',
        contentType: 'image/jpeg',
        fileSize: 512,
      }),
    })
    const { uploadUrl: uploadUrlB, fileUrl: fileUrlB } =
      (await presignB.json()) as {
        uploadUrl: string
        fileUrl: string
        key: string
      }
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
        saveDefaultSplittingOptions: false,
        documents: [
          { id: docIdA, url: fileUrlA, width: 100, height: 100 },
          { id: docIdB, url: fileUrlB, width: 200, height: 200 },
        ],
        recurrenceRule: 'NONE',
      },
    })

    expect((await listObjects('documents/')).length).toBe(2)
    expect((await listObjects('tmp/')).length).toBe(0)

    // Upload A' (replacement for A)
    const presignAprime = await app.request('/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        ledgerId,
        fileName: 'a-prime.jpg',
        contentType: 'image/jpeg',
        fileSize: 512,
      }),
    })
    const { uploadUrl: uploadUrlAprime, fileUrl: fileUrlAprime } =
      (await presignAprime.json()) as {
        uploadUrl: string
        fileUrl: string
        key: string
      }
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
        saveDefaultSplittingOptions: false,
        documents: [
          { id: docIdAprime, url: fileUrlAprime, width: 150, height: 150 },
        ],
        recurrenceRule: 'NONE',
      },
    })

    const docKeysAfterUpdate = await listObjects('documents/')
    expect(docKeysAfterUpdate.length).toBe(1)
    expect((await listObjects('tmp/')).length).toBe(0)

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
  it('4a: presign — no cookie returns 401', async () => {
    const res = await app.request('/uploads/presign', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        ledgerId: 'some-ledger',
        fileName: 'test.jpg',
        contentType: 'image/jpeg',
      }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Unauthenticated')
  })

  it('4b: presign — empty body (no ledgerId) returns 400', async () => {
    const runId = testRunId()
    const email = `s4b-${runId}@test.example`

    const { cookie } = await createSession(email)
    expect(cookie).not.toBe('')

    const res = await app.request('/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        fileName: 'test.jpg',
        contentType: 'image/jpeg',
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Missing ledgerId')
  })

  it('4c: presign — fileSize > 2MB returns 400', async () => {
    const runId = testRunId()
    const email = `s4c-${runId}@test.example`

    const { cookie, accountId } = await createSession(email)
    expect(cookie).not.toBe('')

    const { ledgerId } = await createGroup(`Auth4c-${runId}`, accountId, email)

    const res = await app.request('/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        ledgerId,
        fileName: 'large.jpg',
        contentType: 'image/jpeg',
        fileSize: 2 * 1024 * 1024 + 1,
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/exceeds the maximum upload size/i)
  })

  it('4d: presign — non-member returns 403', async () => {
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
    const { cookie: cookieB } = await createSession(emailB)
    expect(cookieB).not.toBe('')

    const res = await app.request('/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({
        ledgerId,
        fileName: 'test.jpg',
        contentType: 'image/jpeg',
      }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/not authorized/i)
  })

  it('4e: presign — valid cookie + member returns 200 with callable URL', async () => {
    const runId = testRunId()
    const email = `s4e-${runId}@test.example`

    const { cookie, accountId } = await createSession(email)
    expect(cookie).not.toBe('')

    const { ledgerId } = await createGroup(`Auth4e-${runId}`, accountId, email)

    const res = await app.request('/uploads/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        ledgerId,
        fileName: 'test.jpg',
        contentType: 'image/jpeg',
        fileSize: 512,
      }),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      uploadUrl: string
      fileUrl: string
      key: string
    }
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

    const tmpKeys = await listObjects('tmp/')
    expect(tmpKeys.length).toBe(1)
    expect(tmpKeys[0]).toBe(data.key)
  })
})
