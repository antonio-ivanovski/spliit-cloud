import { prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accountRouter } from '../trpc/routers/account'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

/**
 * Integration tests for the per-user, per-group default split
 * persistence. The default lives in `AccountGroupPreference.defaultSplit`
 * and is round-tripped through `accountRouter.defaultSplit` (query) and
 * `accountRouter.setDefaultSplit` (mutation).
 *
 * These tests use a real PostgreSQL database via Prisma so they cover
 * the membership check, the JSON column shape, and the read-back path
 * in addition to zod validation.
 */
describe('defaultSplit — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-admin-${runId}`
  const adminEmail = `admin-${runId}@test.example`

  const ledgerIds: string[] = []
  function trackLedger(id: string) {
    ledgerIds.push(id)
  }

  function makeAccountCaller(overrides?: {
    accountId?: string
    email?: string
  }) {
    return accountRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: overrides?.accountId ?? adminId,
          email: overrides?.email ?? adminEmail,
          emailVerified: true,
          name: 'Test Admin',
        },
      },
    } as never)
  }

  function makeGroupsCaller() {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: adminId,
          email: adminEmail,
          emailVerified: true,
          name: 'Test Admin',
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
        name: 'Test Admin',
      },
    })
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
  })

  it('returns null when no default has been saved', async () => {
    const { groupId } = await makeGroupsCaller().create({
      groupFormValues: {
        name: `DS Empty ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Alice' }],
      },
    })
    const group = await prisma.group.findUnique({ where: { id: groupId } })
    trackLedger(group!.ledgerId)

    const result = await makeAccountCaller().defaultSplit({ groupId })
    expect(result.defaultSplit).toBeNull()
  })

  it('persists a BY_PERCENTAGE default and round-trips it', async () => {
    const { groupId } = await makeGroupsCaller().create({
      groupFormValues: {
        name: `DS Percent ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Alice' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group!.ledgerId)
    const admin = group!.members[0]
    const adminParticipantId = admin.ledgerParticipant!.id

    const set = await makeAccountCaller().setDefaultSplit({
      groupId,
      defaultSplit: {
        splitMode: 'BY_PERCENTAGE',
        paidFor: [{ participant: adminParticipantId, shares: 10000 }],
      },
    })
    expect(set.defaultSplit.splitMode).toBe('BY_PERCENTAGE')

    const get = await makeAccountCaller().defaultSplit({ groupId })
    expect(get.defaultSplit).toEqual({
      splitMode: 'BY_PERCENTAGE',
      paidFor: [{ participant: adminParticipantId, shares: 10000 }],
    })
  })

  it('rejects writes when the user is not an active member', async () => {
    const outsiderEmail = `outsider-${runId}@test.example`
    const outsiderId = `acct-outsider-${runId}`
    await prisma.account.upsert({
      where: { email: outsiderEmail },
      update: {},
      create: {
        id: outsiderId,
        email: outsiderEmail,
        emailVerified: true,
        name: 'Outsider',
      },
    })
    try {
      const { groupId } = await makeGroupsCaller().create({
        groupFormValues: {
          name: `DS Authz ${runId}`,
          currency: '$',
          currencyCode: 'USD',
          participants: [{ name: 'Alice' }],
        },
      })
      const group = await prisma.group.findUnique({ where: { id: groupId } })
      trackLedger(group!.ledgerId)

      const caller = makeAccountCaller({
        accountId: outsiderId,
        email: outsiderEmail,
      })
      await expect(
        caller.setDefaultSplit({
          groupId,
          defaultSplit: {
            splitMode: 'EVENLY',
            paidFor: [{ participant: 'lp-not-in-group', shares: 1 }],
          },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })

      const get = await caller.defaultSplit({ groupId })
      expect(get.defaultSplit).toBeNull()
    } finally {
      await prisma.account.delete({ where: { id: outsiderId } }).catch(() => {})
    }
  })

  it('rejects writes that reference a participant outside the ledger', async () => {
    const { groupId } = await makeGroupsCaller().create({
      groupFormValues: {
        name: `DS Bad Part ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Alice' }],
      },
    })
    const group = await prisma.group.findUnique({ where: { id: groupId } })
    trackLedger(group!.ledgerId)

    await expect(
      makeAccountCaller().setDefaultSplit({
        groupId,
        defaultSplit: {
          splitMode: 'EVENLY',
          paidFor: [{ participant: 'lp-not-in-group', shares: 1 }],
        },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('overwrites an existing default on a second call', async () => {
    const { groupId } = await makeGroupsCaller().create({
      groupFormValues: {
        name: `DS Upsert ${runId}`,
        currency: '$',

        currencyCode: 'USD',
        participants: [{ name: 'Alice' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group!.ledgerId)
    const adminParticipantId = group!.members[0].ledgerParticipant!.id

    const caller = makeAccountCaller()
    await caller.setDefaultSplit({
      groupId,
      defaultSplit: {
        splitMode: 'BY_SHARES',
        paidFor: [{ participant: adminParticipantId, shares: 3 }],
      },
    })

    await caller.setDefaultSplit({
      groupId,
      defaultSplit: {
        splitMode: 'EVENLY',
        paidFor: [{ participant: adminParticipantId, shares: 1 }],
      },
    })

    const get = await caller.defaultSplit({ groupId })
    expect(get.defaultSplit?.splitMode).toBe('EVENLY')
  })

  it('replaces paidFor children on upsert (no orphan rows)', async () => {
    const { groupId } = await makeGroupsCaller().create({
      groupFormValues: {
        name: `DS Children ${runId}`,
        currency: '$',

        currencyCode: 'USD',
        participants: [{ name: 'Alice' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group!.ledgerId)
    const adminParticipantId = group!.members[0].ledgerParticipant!.id

    const caller = makeAccountCaller()
    await caller.setDefaultSplit({
      groupId,
      defaultSplit: {
        splitMode: 'BY_SHARES',
        paidFor: [{ participant: adminParticipantId, shares: 7 }],
      },
    })
    // Second write with a different share count — should fully replace
    // the previous children rather than append.
    await caller.setDefaultSplit({
      groupId,
      defaultSplit: {
        splitMode: 'BY_SHARES',
        paidFor: [{ participant: adminParticipantId, shares: 1 }],
      },
    })

    const header = await prisma.accountGroupDefaultSplit.findUnique({
      where: {
        accountId_groupId: { accountId: adminId, groupId },
      },
      include: { paidFor: true },
    })
    expect(header).not.toBeNull()
    // Exactly one child row, not two — the delete-then-create path
    // collapses the previous write.
    expect(header!.paidFor).toHaveLength(1)
    expect(header!.paidFor[0].shares).toBe(1)
  })
})
