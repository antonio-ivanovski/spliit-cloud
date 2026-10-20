import { makeSignature } from 'better-auth/crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { prisma } from '@spliit/db'

import { app } from '../app'
import { auth } from '../lib/auth'
import { getWebBaseUrl } from '../lib/auth/urls'
import { env } from '../lib/env'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('profile writes and cached browser sessions', () => {
  const accountIds: string[] = []

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: accountIds } } })
  })

  async function browserSession() {
    const id = testRunId()
    const accountId = `profile-${id}`
    accountIds.push(accountId)
    await prisma.user.create({
      data: {
        id: accountId,
        email: `${id}@test.example`,
        name: '',
        emailVerified: true,
      },
    })
    const token = crypto.randomUUID()
    await prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        userId: accountId,
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    const signature = await makeSignature(token, env.BETTER_AUTH_SECRET)
    const jar = new Map([
      ['better-auth.session_token', `${token}.${signature}`],
    ])
    function applyCookies(response: Response) {
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]!
        const separator = pair.indexOf('=')
        jar.set(pair.slice(0, separator), pair.slice(separator + 1))
      }
    }
    const headers = () => ({
      cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '),
      origin: getWebBaseUrl(),
      'content-type': 'application/json',
    })
    const snapshot = await app.request('/auth/get-session', {
      headers: headers(),
    })
    expect(snapshot.status).toBe(200)
    expect(
      snapshot.headers
        .getSetCookie()
        .some((cookie) => cookie.includes('session_data=')),
    ).toBe(true)
    applyCookies(snapshot)
    return { accountId, headers, applyCookies }
  }

  it('refreshes the browser cookie so an ordinary cached session read sees the saved name immediately', async () => {
    const browser = await browserSession()
    const response = await app.request('/trpc/account.updateProfile', {
      method: 'POST',
      headers: browser.headers(),
      body: JSON.stringify({ json: { name: 'Updated Profile' } }),
    })
    expect(response.status).toBe(200)
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.includes('session_data=')),
    ).toBe(true)
    browser.applyCookies(response)
    const session = await app.request('/auth/get-session', {
      headers: browser.headers(),
    })
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({
      user: { id: browser.accountId, name: 'Updated Profile' },
    })
  })

  it('does not partially write the profile when the authenticated write fails', async () => {
    const browser = await browserSession()
    const update = vi
      .spyOn(auth.api, 'updateUser')
      .mockRejectedValueOnce(new Error('Profile write unavailable'))
    try {
      const response = await app.request('/trpc/account.updateProfile', {
        method: 'POST',
        headers: browser.headers(),
        body: JSON.stringify({ json: { name: 'Must Not Persist' } }),
      })
      expect(response.status).toBe(500)
      expect(
        await prisma.user.findUniqueOrThrow({
          where: { id: browser.accountId },
          select: { name: true },
        }),
      ).toEqual({ name: '' })
    } finally {
      update.mockRestore()
    }
  })
})
