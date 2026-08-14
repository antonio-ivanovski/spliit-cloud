import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Public view-only query param — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-public-route-${runId}`
  const adminEmail = `public-route-${runId}@test.example`
  let groupId: string
  let ledgerId: string
  let viewKey: string

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
    viewKey = new URL(enabled.url).searchParams.get('viewKey')!
  })

  afterAll(async () => {
    await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
  })

  it('uses the canonical group id plus viewKey across group read procedures', async () => {
    const caller = publicCaller()
    const input = { groupId, viewKey }
    const [group, details, balances, activities] = await Promise.all([
      caller.get(input),
      caller.getDetails(input),
      caller.balances.list(input),
      caller.activities.list(input),
    ])

    expect(group).toMatchObject({
      viewer: { source: 'PUBLIC_LINK', access: 'READ_ONLY' },
    })
    expect(group.group.id).toBe(groupId)
    expect(details.group.id).toBe(groupId)
    expect(details.group.invitations).toEqual([])
    expect(details.group.members[0]?.account.image).toBeNull()
    expect(balances).toHaveProperty('balances')
    expect(activities).toHaveProperty('activities')
  })

  it('upgrades an active member who opens the public view link', async () => {
    await expect(
      adminCaller().get({ groupId, viewKey }),
    ).resolves.toMatchObject({
      viewer: { source: 'MEMBER', access: 'READ_WRITE' },
    })
  })

  it('invalidates the old key immediately when replaced or removed', async () => {
    const replaced = await adminCaller().view.replace({
      groupId,
      confirmed: true,
    })
    const replacementKey = new URL(replaced.url).searchParams.get('viewKey')!

    await expect(
      publicCaller().get({ groupId, viewKey }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      publicCaller().get({ groupId, viewKey: replacementKey }),
    ).resolves.toMatchObject({ viewer: { source: 'PUBLIC_LINK' } })

    await adminCaller().view.remove({ groupId, confirmed: true })
    await expect(
      publicCaller().get({ groupId, viewKey: replacementKey }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
