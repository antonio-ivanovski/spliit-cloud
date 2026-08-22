import { afterAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { app } from '../app'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

const STRONG = 'Str0ng!Pass1'
const STRONG_WRONG = 'Wr0ng!Pass2'

const trackedAccountIds: string[] = []

afterAll(async () => {
  if (trackedAccountIds.length > 0) {
    await prisma.session.deleteMany({
      where: { userId: { in: trackedAccountIds } },
    })
    await prisma.authIdentity.deleteMany({
      where: { userId: { in: trackedAccountIds } },
    })
    await prisma.account.deleteMany({
      where: { id: { in: trackedAccountIds } },
    })
  }
})

async function signUpAndGetCookie(
  email: string,
  name: string,
  password: string,
) {
  const headers = {
    'content-type': 'application/json',
    origin: 'http://localhost:3000',
  }
  const signUpRes = await app.request('/auth/sign-up/email', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, name }),
  })
  // requireEmailVerification:true → sign-up does not mint a session, but user is created
  const signUpBody = (await signUpRes.json().catch(() => ({}))) as {
    user?: { id: string }
  }
  // Ensure account exists
  const account = await prisma.account.findUnique({
    where: { email: email.toLowerCase() },
  })
  if (!account)
    throw new Error(
      `account not created for ${email}: ${JSON.stringify(signUpBody)}`,
    )
  // Make email verified so sign-in is allowed
  await prisma.account.update({
    where: { id: account.id },
    data: { emailVerified: true },
  })
  const signInRes = await app.request('/auth/sign-in/email', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  })
  if (!signInRes.ok)
    throw new Error(
      `sign-in failed ${signInRes.status} ${await signInRes.text()}`,
    )
  const setCookie = signInRes.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/better-auth\.session_token=([^;,]+)/)
  const cookie = match ? `better-auth.session_token=${match[1]}` : ''
  if (!cookie) throw new Error('no session cookie')
  return { account, cookie }
}

describe('password-set for Google OAuth users → credential sign-in', () => {
  const runId = testRunId()

  it('Google-only account can set password and then sign in with email+password (including mixed-case)', async () => {
    const email = `pw-social-${runId}@test.example`
    const name = 'Social User'

    // 1. Sign up via email (creates verified credential user), then turn into Google-only
    const { account, cookie } = await signUpAndGetCookie(email, name, STRONG)
    trackedAccountIds.push(account.id)

    // Delete the credential identity created by sign-up, then add Google identity
    await prisma.authIdentity.deleteMany({
      where: { userId: account.id, providerId: 'credential' },
    })
    await prisma.authIdentity.create({
      data: {
        id: `google-${runId}`,
        userId: account.id,
        providerId: 'google',
        issuer: 'https://accounts.google.com',
        accountId: `google-sub-${runId}`,
      },
    })

    // Sanity: no credential row left, so sign-in should fail before set
    const preRes = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ email, password: STRONG }),
    })
    expect(preRes.status).toBe(401)

    // 2. Status before set
    let statusRes = await app.request('/auth/password/status', {
      method: 'GET',
      headers: { cookie, origin: 'http://localhost:3000' },
    })
    expect(statusRes.status).toBe(200)
    expect((await statusRes.json()) as { hasPassword: boolean }).toEqual({
      hasPassword: false,
    })

    // 3. Set password via official-shaped endpoint
    const setRes = await app.request('/auth/password/set', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ newPassword: STRONG }),
    })
    expect(setRes.status).toBe(200)
    expect(await setRes.json()).toEqual({ success: true })

    // 4. DB row is canonical (issuer, accountId, providerId)
    const cred = await prisma.authIdentity.findFirst({
      where: { userId: account.id, providerId: 'credential' },
    })
    expect(cred).toBeTruthy()
    expect(cred!.issuer).toBe('local:credential')
    expect(cred!.accountId).toBe(account.id)
    expect(cred!.password).toBeTruthy()

    // 5. Status after set
    statusRes = await app.request('/auth/password/status', {
      method: 'GET',
      headers: { cookie, origin: 'http://localhost:3000' },
    })
    expect((await statusRes.json()) as { hasPassword: boolean }).toEqual({
      hasPassword: true,
    })

    // 6. Sign in with email+password now succeeds
    const signInRes = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ email, password: STRONG }),
    })
    expect(signInRes.status).toBe(200)
    expect(signInRes.headers.get('set-cookie')).toContain(
      'better-auth.session_token',
    )

    // 7. Mixed-case email lookup also succeeds (stored lowercased)
    const mixed = email.toUpperCase()
    const mixedRes = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ email: mixed, password: STRONG }),
    })
    expect(mixedRes.status).toBe(200)

    // 8. Wrong password still 401 (not a missing-credential miss)
    const wrongRes = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ email, password: STRONG_WRONG }),
    })
    expect(wrongRes.status).toBe(401)
  })

  it('stray legacy credential row does not prevent creating canonical row', async () => {
    const email = `pw-stray-${runId}@test.example`
    const { account, cookie } = await signUpAndGetCookie(
      email,
      'Stray User',
      STRONG,
    )
    trackedAccountIds.push(account.id)

    // Simulate stray credential-shaped row with wrong issuer
    await prisma.authIdentity.deleteMany({ where: { userId: account.id } })
    await prisma.authIdentity.create({
      data: {
        id: `stray-${runId}`,
        userId: account.id,
        providerId: 'credential',
        issuer: 'local:legacy',
        accountId: `legacy-${runId}`,
        password: null,
      },
    })
    await prisma.authIdentity.create({
      data: {
        id: `google-stray-${runId}`,
        userId: account.id,
        providerId: 'google',
        issuer: 'https://accounts.google.com',
        accountId: `google-stray-${runId}`,
      },
    })

    const setRes = await app.request('/auth/password/set', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ newPassword: STRONG }),
    })
    expect(setRes.status).toBe(200)

    // Canonical row must exist (issuer local:credential, accountId userId)
    const canonical = await prisma.authIdentity.findFirst({
      where: {
        userId: account.id,
        providerId: 'credential',
        issuer: 'local:credential',
        accountId: account.id,
      },
    })
    expect(canonical).toBeTruthy()
    expect(canonical!.password).toBeTruthy()

    // Sign-in must succeed via canonical row
    const signInRes = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ email, password: STRONG }),
    })
    expect(signInRes.status).toBe(200)
  })
})
