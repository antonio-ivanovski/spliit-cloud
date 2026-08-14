import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Public View-only path — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-public-route-${runId}`
  const adminEmail = `public-route-${runId}@test.example`
  let groupId: string
  let ledgerId: string
  let publicViewId: string

  const adminCaller = () =>
    groupsRouter.createCaller({
      auth: {
        session: { id: 'session-public-route' },
        user: {
          id: adminId,
          email: adminEmail,
          emailVerified: true,
          isAnonymous: false,
          name: 'Public Route Admin',
        },
      },
    } as never)

  const publicCaller = () => groupsRouter.createCaller({ auth: null } as never)

  beforeAll(async () => {
    await prisma.account.create({
      data: {
        id: adminId,
        email: adminEmail,
        emailVerified: true,
        name: 'Public Route Admin',
      },
    })
    const created = await adminCaller().create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Public route ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Public Route Admin' }],
      },
    })
    groupId = created.groupId
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { ledgerId: true },
    })
    ledgerId = group.ledgerId
    const enabled = await adminCaller().view.enable({ groupId })
    publicViewId = new URL(enabled.url).pathname.split('/').at(-1)!
  })

  afterAll(async () => {
    await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
  })

  it('uses the opaque path id across group read procedures', async () => {
    const caller = publicCaller()
    const [group, details, balances, activities] = await Promise.all([
      caller.get({ groupId: publicViewId }),
      caller.getDetails({ groupId: publicViewId }),
      caller.balances.list({ groupId: publicViewId }),
      caller.activities.list({ groupId: publicViewId }),
    ])

    expect(group).toMatchObject({
      canonicalGroupId: groupId,
      viewer: { source: 'PUBLIC_LINK', access: 'READ_ONLY' },
    })
    expect(details.group.id).toBe(groupId)
    expect(balances).toHaveProperty('balances')
    expect(activities).toHaveProperty('activities')
  })

  it('upgrades an active member who opens the public alias', async () => {
    await expect(
      adminCaller().get({ groupId: publicViewId }),
    ).resolves.toMatchObject({
      canonicalGroupId: groupId,
      viewer: { source: 'MEMBER', access: 'READ_WRITE' },
    })
  })

  it('invalidates the old path immediately when replaced or removed', async () => {
    const replaced = await adminCaller().view.replace({
      groupId,
      confirmed: true,
    })
    const replacementId = new URL(replaced.url).pathname.split('/').at(-1)!

    await expect(
      publicCaller().get({ groupId: publicViewId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      publicCaller().get({ groupId: replacementId }),
    ).resolves.toMatchObject({ viewer: { source: 'PUBLIC_LINK' } })

    await adminCaller().view.remove({ groupId, confirmed: true })
    await expect(
      publicCaller().get({ groupId: replacementId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
