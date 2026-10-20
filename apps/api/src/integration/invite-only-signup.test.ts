import { afterAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { app } from '../app'
import { SIGNUP_INVITE_HEADER } from '../lib/auth/signup-gate'
import { getWebBaseUrl } from '../lib/auth/urls'
import { env } from '../lib/env'
import { groupsRouter } from '../trpc/routers/groups'
import { invitationsRouter } from '../trpc/routers/invitations'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('invite-only signup through the HTTP auth boundary', () => {
  const accountIds: string[] = []
  const ledgerIds: string[] = []
  const previous = {
    SIGNUP_MODE: env.SIGNUP_MODE,
    ENABLE_ANONYMOUS_AUTH: env.ENABLE_ANONYMOUS_AUTH,
  }

  afterAll(async () => {
    Object.assign(env, previous)
    await prisma.ledger.deleteMany({ where: { id: { in: ledgerIds } } })
    await prisma.user.deleteMany({ where: { id: { in: accountIds } } })
  })

  it('admits successive invite holders until capacity, without admitting view-only visitors or signing out existing members', async () => {
    env.SIGNUP_MODE = 'invite_only'
    env.ENABLE_ANONYMOUS_AUTH = true
    const id = testRunId()
    const admin = await prisma.user.create({
      data: {
        id,
        email: `${id}@test.example`,
        name: 'Admin',
        emailVerified: true,
      },
    })
    accountIds.push(admin.id)
    const context = {
      auth: { session: { id: 'test-session' }, user: admin },
    } as never
    const { groupId } = await groupsRouter.createCaller(context).create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: 'Invite-only group',
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
    })
    ledgerIds.push(group.ledgerId)
    const viewKey = crypto.randomUUID()
    await prisma.group.update({
      where: { id: groupId },
      data: { publicViewKey: viewKey },
    })
    const link = await invitationsRouter
      .createCaller(context)
      .createSharedLink({
        requestId: crypto.randomUUID(),
        groupId,
        maxUses: 2,
      })
    const token = new URL(link.inviteUrl).searchParams.get('invite')!
    const signup = (proof?: string) =>
      app.request('/auth/sign-in/anonymous', {
        method: 'POST',
        headers: {
          origin: getWebBaseUrl(),
          'content-type': 'application/json',
          ...(proof ? { [SIGNUP_INVITE_HEADER]: proof } : {}),
        },
        body: '{}',
      })

    for (const proof of [undefined, viewKey]) {
      const denied = await signup(proof)
      expect(denied.status).toBe(403)
      expect(await denied.json()).toMatchObject({
        code: 'SIGNUP_INVITE_REQUIRED',
      })
    }

    const cookies: string[] = []
    const recoveryCodes: string[] = []
    for (let accepted = 0; accepted < 2; accepted += 1) {
      const response = await signup(token)
      expect(response.status).toBe(200)
      const result = await response.json()
      accountIds.push(result.user.id)
      cookies.push(
        response.headers
          .getSetCookie()
          .map((cookie) => cookie.split(';')[0])
          .join('; '),
      )
      expect(
        await prisma.groupInvitation.findUniqueOrThrow({
          where: { id: link.invitationId },
        }),
      ).toMatchObject({
        status: 'PENDING',
        useCount: accepted,
      })
      expect(
        await prisma.groupMember.findUnique({
          where: { groupId_accountId: { groupId, accountId: result.user.id } },
        }),
      ).toBeNull()
      const headers = {
        cookie: cookies.at(-1)!,
        origin: getWebBaseUrl(),
        'content-type': 'application/json',
      }
      const profile = await app.request('/trpc/account.updateProfile', {
        method: 'POST',
        headers,
        body: JSON.stringify({ json: { name: `Guest ${accepted}` } }),
      })
      expect(profile.status).toBe(200)
      const setup = await app.request('/auth/anonymous-recovery/setup', {
        method: 'POST',
        headers,
        body: '{}',
      })
      expect(setup.status).toBe(200)
      const { code } = await setup.json()
      recoveryCodes.push(code)
      const acknowledge = await app.request(
        '/auth/anonymous-recovery/acknowledge',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ code, confirmedCopied: true }),
        },
      )
      expect(acknowledge.status).toBe(200)
      const join = await app.request('/trpc/invitations.acceptLink', {
        method: 'POST',
        headers,
        body: JSON.stringify({ json: { token, expectedGroupId: groupId } }),
      })
      expect(join.status).toBe(200)
      expect(
        await prisma.groupMember.findUniqueOrThrow({
          where: { groupId_accountId: { groupId, accountId: result.user.id } },
        }),
      ).toMatchObject({ status: 'ACTIVE' })
    }

    const denied = await signup(token)
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({
      code: 'SIGNUP_INVITE_REQUIRED',
    })
    expect(
      await prisma.groupInvitation.findUniqueOrThrow({
        where: { id: link.invitationId },
      }),
    ).toMatchObject({ useCount: 2 })
    for (const code of recoveryCodes) {
      const recovery = await app.request('/auth/sign-in/anonymous-recovery', {
        method: 'POST',
        headers: {
          origin: getWebBaseUrl(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code }),
      })
      expect(recovery.status).toBe(200)
      expect(accountIds).toContain((await recovery.json()).user.id)
    }
    // Admission must also reject links which end without filling their capacity.
    for (const ended of [
      {
        status: 'PENDING' as const,
        expiresAt: new Date(0),
        tokenHash: undefined,
      },
      { status: 'REVOKED' as const, expiresAt: null, tokenHash: undefined },
      {
        status: 'PENDING' as const,
        expiresAt: null,
        tokenHash: crypto.randomUUID(),
      },
    ]) {
      await prisma.groupInvitation.update({
        where: { id: link.invitationId },
        data: { ...ended, maxUses: null },
      })
      const rejected = await signup(token)
      expect(rejected.status).toBe(403)
      expect(await rejected.json()).toMatchObject({
        code: 'SIGNUP_INVITE_REQUIRED',
      })
    }
    for (const cookie of cookies) {
      const session = await app.request('/auth/get-session', {
        headers: { cookie },
      })
      expect(session.status).toBe(200)
      expect((await session.json()).user.id).toBeTruthy()
    }
  })
})
