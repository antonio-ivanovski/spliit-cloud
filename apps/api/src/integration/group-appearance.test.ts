import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'
import { type GroupFormValues } from '@spliit/domain'

import { setDefaultActivityNotificationDispatchers } from '../lib/notifications/dispatcher'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('Group appearance — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-appearance-admin-${runId}`
  const memberId = `acct-appearance-member-${runId}`

  const ledgerIds: string[] = []

  function makeCaller(accountId = adminId) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-appearance' },
        user: {
          id: accountId,
          email: `${accountId}@test.example`,
          emailVerified: true,
          name:
            accountId === adminId ? 'Appearance Admin' : 'Appearance Member',
        },
      },
    } as never)
  }

  async function createGroup(overrides: Partial<GroupFormValues> = {}) {
    const caller = makeCaller()
    const { groupId } = await caller.create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Appearance ${runId} ${Math.random().toString(36).slice(2, 6)}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
        ...overrides,
      },
    })
    const stored = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
    })
    ledgerIds.push(stored.ledgerId)
    return { groupId, stored }
  }

  beforeAll(async () => {
    setDefaultActivityNotificationDispatchers([])
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          email: `${adminId}@test.example`,
          emailVerified: true,
          name: 'Appearance Admin',
        },
        {
          id: memberId,
          email: `${memberId}@test.example`,
          emailVerified: true,
          name: 'Appearance Member',
        },
      ],
      skipDuplicates: true,
    })
  })

  afterAll(async () => {
    for (const ledgerId of ledgerIds) {
      await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
    }
    await prisma.user
      .deleteMany({ where: { id: { in: [adminId, memberId] } } })
      .catch(() => {})
  })

  it('stays blank on create without a title emoji', async () => {
    const name = `Blank Slate ${runId}`
    const { stored } = await createGroup({ name })
    expect(stored.name).toBe(name)
    expect(stored.emoji).toBeNull()
    expect(stored.color).toBeNull()
  })

  it('stores a title emoji verbatim on create (extraction is client-side)', async () => {
    const { stored } = await createGroup({ name: `🏝️ Island ${runId}` })
    expect(stored.name).toBe(`🏝️ Island ${runId}`)
    expect(stored.emoji).toBeNull()
  })

  it('stores explicit picks verbatim and keeps the name untouched', async () => {
    const { stored } = await createGroup({
      name: `🏝️ Verbatim ${runId}`,
      emoji: '🎉',
      color: 'pink',
    })
    expect(stored.name).toBe(`🏝️ Verbatim ${runId}`)
    expect(stored.emoji).toBe('🎉')
    expect(stored.color).toBe('pink')
  })

  it('keeps the declined sentinel and leaves color blank', async () => {
    const { stored } = await createGroup({
      name: `Declined ${runId}`,
      emoji: '',
    })
    expect(stored.emoji).toBe('')
    expect(stored.color).toBeNull()
  })

  it('updates, clears, and leaves appearance untouched based on the input shape', async () => {
    const caller = makeCaller()
    const { groupId } = await createGroup({ name: `Update ${runId}` })

    const baseValues = {
      name: `Update ${runId}`,
      currency: '$',
      currencyCode: 'USD',
      participants: [{ name: 'Admin' }],
    }

    // Explicit picks persist, including custom hex colors.
    await caller.update({
      groupId,
      groupFormValues: { ...baseValues, emoji: '🚀', color: 'violet' },
    })
    let stored = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
    })
    expect(stored.emoji).toBe('🚀')
    expect(stored.color).toBe('violet')

    await caller.update({
      groupId,
      groupFormValues: { ...baseValues, emoji: '🚀', color: '#a1b2c3' },
    })
    stored = await prisma.group.findUniqueOrThrow({ where: { id: groupId } })
    expect(stored.color).toBe('#a1b2c3')

    // Omitted fields (partial API callers) leave the stored values alone.
    await caller.update({ groupId, groupFormValues: baseValues })
    stored = await prisma.group.findUniqueOrThrow({ where: { id: groupId } })
    expect(stored.emoji).toBe('🚀')
    expect(stored.color).toBe('#a1b2c3')

    // `''` and `null` clear the pick; the trip through groups.get preserves
    // the sentinel (crucial for the intro-prompt gate).
    await caller.update({
      groupId,
      groupFormValues: { ...baseValues, emoji: '', color: null },
    })
    stored = await prisma.group.findUniqueOrThrow({ where: { id: groupId } })
    expect(stored.emoji).toBe('')
    expect(stored.color).toBeNull()

    const fetched = await caller.get({ groupId })
    expect(fetched.group.emoji).toBe('')
    expect(fetched.group.color).toBeNull()
  })

  it('dismissEmojiIntro writes the sentinel only from the undecided state', async () => {
    const caller = makeCaller()
    // New groups stay blank; reset to NULL to simulate a group created
    // before the appearance feature.
    const undecided = await createGroup({ name: `Dismiss ${runId}` })
    await prisma.group.update({
      where: { id: undecided.groupId },
      data: { emoji: null },
    })

    await caller.dismissEmojiIntro({ groupId: undecided.groupId })
    let stored = await prisma.group.findUniqueOrThrow({
      where: { id: undecided.groupId },
    })
    expect(stored.emoji).toBe('')

    // Idempotent.
    await caller.dismissEmojiIntro({ groupId: undecided.groupId })
    stored = await prisma.group.findUniqueOrThrow({
      where: { id: undecided.groupId },
    })
    expect(stored.emoji).toBe('')

    // Never clobbers an explicit pick.
    const picked = await createGroup({ name: `Picked ${runId}`, emoji: '🎉' })
    await caller.dismissEmojiIntro({ groupId: picked.groupId })
    stored = await prisma.group.findUniqueOrThrow({
      where: { id: picked.groupId },
    })
    expect(stored.emoji).toBe('🎉')
  })

  it('rejects appearance changes from MEMBERs', async () => {
    const { groupId } = await createGroup({ name: `Member Role ${runId}` })
    await prisma.groupMember.create({
      data: {
        id: `gm-member-${runId}`,
        groupId,
        accountId: memberId,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })

    const memberCaller = makeCaller(memberId)
    await expect(
      memberCaller.update({
        groupId,
        groupFormValues: {
          name: `Member Role ${runId}`,
          currency: '$',
          currencyCode: 'USD',
          participants: [{ name: 'Member' }],
          emoji: '🎉',
        },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      memberCaller.dismissEmojiIntro({ groupId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const stored = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
    })
    expect(stored.emoji).not.toBe('🎉')
    expect(stored.emoji).not.toBe('')
  })

  it('rejects dismissing the intro on an archived group', async () => {
    const caller = makeCaller()
    const { groupId } = await createGroup({ name: `Archived ${runId}` })
    await prisma.group.update({
      where: { id: groupId },
      data: { emoji: null },
    })
    await caller.archive({ groupId, archived: true, force: true })

    await expect(caller.dismissEmojiIntro({ groupId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    const stored = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
    })
    expect(stored.emoji).toBeNull()
  })

  it('honors an explicit pick on the import path', async () => {
    const caller = makeCaller()
    const guestDestId = crypto.randomUUID()
    const result = await caller.import({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: `Imported Pick ${runId}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Owner' }],
        emoji: '🎉',
        color: 'pink',
      },
      participants: [
        {
          mode: 'INVITE_BY_LINK',
          sourceName: 'Guest',
          destLedgerParticipantId: guestDestId,
        },
      ],
      expenses: [
        {
          title: 'Imported',
          amount: 1000,
          expenseDate: new Date('2026-06-01'),
          category: 'general',
          splitMode: 'EVENLY',
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [{ participant: guestDestId, shares: 1000 }],
          paidFor: [{ participant: guestDestId, shares: 1 }],
          isReimbursement: false,
          documents: [],
          recurrenceRule: 'NONE',
        },
      ],
    })
    ledgerIds.push(result.ledgerId)

    const stored = await prisma.group.findUniqueOrThrow({
      where: { id: result.groupId },
    })
    expect(stored.emoji).toBe('🎉')
    expect(stored.color).toBe('pink')
  })

  it('leaves FRIEND ledgers without appearance even when updated', async () => {
    const caller = makeCaller()
    const ledger = await prisma.ledger.create({
      data: {
        id: `ledger-friend-${runId}`,
        currency: '$',
        currencyCode: 'USD',
      },
    })
    ledgerIds.push(ledger.id)
    const friendName = `friend-${runId}`
    const group = await prisma.group.create({
      data: {
        id: `group-friend-${runId}`,
        name: friendName,
        groupType: 'FRIEND',
        ledgerId: ledger.id,
      },
    })
    await prisma.groupMember.create({
      data: {
        id: `gm-friend-${runId}`,
        groupId: group.id,
        accountId: adminId,
        role: 'ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })

    await caller.update({
      groupId: group.id,
      groupFormValues: {
        name: friendName,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
        emoji: '🎉',
        color: 'pink',
      },
    })

    const stored = await prisma.group.findUniqueOrThrow({
      where: { id: group.id },
    })
    expect(stored.emoji).toBeNull()
    expect(stored.color).toBeNull()
  })
})
