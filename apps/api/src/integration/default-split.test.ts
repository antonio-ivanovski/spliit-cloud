import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { mergeLedgerParticipantReferences } from '../lib/api/ledger-participants'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

describe('split presets — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-admin-${runId}`
  const adminEmail = `admin-${runId}@test.example`
  const ledgerIds: string[] = []

  function caller(accountId = adminId, email = adminEmail) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: accountId,
          email,
          emailVerified: true,
          name: accountId === adminId ? 'Test Admin' : 'Test Member',
        },
      },
    } as never)
  }

  async function createGroup(name: string) {
    const result = await caller().create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Alice' }, { name: 'Bob' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: result.groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    expect(group).not.toBeNull()
    ledgerIds.push(group!.ledgerId)
    const adminParticipant = group!.members[0]!.ledgerParticipant!
    const secondParticipant = await prisma.ledgerParticipant.create({
      data: {
        id: crypto.randomUUID(),
        ledgerId: group!.ledgerId,
        kind: 'UNLINKED_PARTICIPANT',
        displayName: 'Bob',
      },
    })
    return {
      id: result.groupId,
      aliceId: adminParticipant.id,
      bobId: secondParticipant.id,
    }
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
    for (const ledgerId of ledgerIds) {
      await prisma.ledger.delete({ where: { id: ledgerId } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId } }).catch(() => {})
  })

  it('supports one-sided CRUD, idempotent creation, and case-insensitive names', async () => {
    const group = await createGroup(`Preset CRUD ${runId}`)
    const requestId = crypto.randomUUID()
    const input = {
      requestId,
      groupId: group.id,
      scope: 'SHARED' as const,
      name: '  Dinner  ',
      target: 'PAID_FOR' as const,
      splitMode: 'BY_SHARES' as const,
      participants: [
        { participant: group.aliceId, shares: 200 },
        { participant: group.bobId, shares: 100 },
      ],
    }
    const first = await caller().splitPresets.create(input)
    expect(await caller().splitPresets.create(input)).toEqual(first)
    expect(first.preset.name).toBe('Dinner')
    expect(first.preset.target).toBe('PAID_FOR')

    await expect(
      caller().splitPresets.create({
        ...input,
        requestId: crypto.randomUUID(),
        name: 'dInNeR',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    const second = await caller().splitPresets.create({
      ...input,
      requestId: crypto.randomUUID(),
      name: 'Lunch',
      target: 'PAID_BY',
      splitMode: 'EVENLY',
      participants: [{ participant: group.aliceId, shares: 99 }],
    })
    expect(second.preset.participants).toEqual([
      { participant: group.aliceId, shares: 1 },
    ])

    const listed = await caller().splitPresets.list({ groupId: group.id })
    expect(listed.canManageShared).toBe(true)
    expect(listed.presets.map((preset) => preset.name)).toEqual([
      'Dinner',
      'Lunch',
    ])

    const updated = await caller().splitPresets.update({
      groupId: group.id,
      presetId: first.preset.id,
      scope: 'SHARED',
      name: 'Dinner Updated',
      expectedUpdatedAt: first.preset.updatedAt,
      target: 'PAID_FOR',
      splitMode: 'BY_PERCENTAGE',
      participants: [
        { participant: group.aliceId, shares: 7500 },
        { participant: group.bobId, shares: 2500 },
      ],
    })
    expect(updated.preset.splitMode).toBe('BY_PERCENTAGE')

    await caller().splitPresets.delete({
      groupId: group.id,
      presetId: first.preset.id,
      scope: 'SHARED',
    })
    expect(
      (await caller().splitPresets.list({ groupId: group.id })).presets.map(
        (preset) => preset.name,
      ),
    ).toEqual(['Lunch'])
  })

  it('allows active members to read and own personal presets, but restricts shared writes', async () => {
    const group = await createGroup(`Preset ACL ${runId}`)
    const memberId = `acct-member-${runId}`
    const memberEmail = `member-${runId}@test.example`
    await prisma.account.create({
      data: {
        id: memberId,
        email: memberEmail,
        emailVerified: true,
        name: 'Test Member',
      },
    })
    const member = await prisma.groupMember.create({
      data: {
        id: crypto.randomUUID(),
        groupId: group.id,
        accountId: memberId,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    const groupRow = await prisma.group.findUniqueOrThrow({
      where: { id: group.id },
      select: { ledgerId: true },
    })
    const memberParticipant = await prisma.ledgerParticipant.create({
      data: {
        id: crypto.randomUUID(),
        ledgerId: groupRow.ledgerId,
        groupMemberId: member.id,
      },
    })
    try {
      const shared = await caller().splitPresets.create({
        requestId: crypto.randomUUID(),
        groupId: group.id,
        scope: 'SHARED',
        name: 'Members',
        target: 'PAID_FOR',
        splitMode: 'EVENLY',
        participants: [{ participant: group.aliceId, shares: 1 }],
      })
      const memberList = await caller(memberId, memberEmail).splitPresets.list({
        groupId: group.id,
      })
      expect(memberList.canManageShared).toBe(false)
      expect(
        memberList.presets.some((preset) => preset.id === shared.preset.id),
      ).toBe(true)

      await expect(
        caller(memberId, memberEmail).splitPresets.create({
          requestId: crypto.randomUUID(),
          groupId: group.id,
          scope: 'SHARED',
          name: 'Forbidden',
          target: 'PAID_FOR',
          splitMode: 'EVENLY',
          participants: [{ participant: group.aliceId, shares: 1 }],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })

      const personal = await caller(memberId, memberEmail).splitPresets.create({
        requestId: crypto.randomUUID(),
        groupId: group.id,
        scope: 'PERSONAL',
        name: 'Private members',
        target: 'PAID_FOR',
        splitMode: 'EVENLY',
        participants: [{ participant: group.aliceId, shares: 1 }],
      })
      expect(
        (
          await caller(memberId, memberEmail).splitPresets.list({
            groupId: group.id,
          })
        ).presets
          .filter((preset) => preset.scope === 'PERSONAL')
          .map((preset) => preset.id),
      ).toEqual([personal.preset.id])
      expect(
        (
          await caller().splitPresets.list({ groupId: group.id })
        ).presets.filter((preset) => preset.scope === 'PERSONAL'),
      ).toHaveLength(0)
      await expect(
        caller(memberId, memberEmail).splitPresets.delete({
          groupId: group.id,
          presetId: shared.preset.id,
          scope: 'SHARED',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(
        caller(
          `acct-outsider-${runId}`,
          `outsider-${runId}@test.example`,
        ).splitPresets.list({
          groupId: group.id,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    } finally {
      await prisma.account.delete({ where: { id: memberId } }).catch(() => {})
      await prisma.ledgerParticipant
        .delete({ where: { id: memberParticipant.id } })
        .catch(() => {})
    }
  })

  it('updates defaults independently and cleans references when a shared preset becomes personal', async () => {
    const group = await createGroup(`Preset defaults ${runId}`)
    const memberId = `acct-default-member-${runId}`
    const memberEmail = `default-member-${runId}@test.example`
    await prisma.account.create({
      data: {
        id: memberId,
        email: memberEmail,
        emailVerified: true,
        name: 'Default member',
      },
    })
    const member = await prisma.groupMember.create({
      data: {
        id: crypto.randomUUID(),
        groupId: group.id,
        accountId: memberId,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    const ledger = await prisma.group.findUniqueOrThrow({
      where: { id: group.id },
      select: { ledgerId: true },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: crypto.randomUUID(),
        ledgerId: ledger.ledgerId,
        groupMemberId: member.id,
      },
    })
    try {
      const paidBy = await caller().splitPresets.create({
        requestId: crypto.randomUUID(),
        groupId: group.id,
        scope: 'SHARED',
        name: 'Payer',
        target: 'PAID_BY',
        splitMode: 'EVENLY',
        participants: [{ participant: group.aliceId, shares: 1 }],
      })
      const paidFor = await caller().splitPresets.create({
        requestId: crypto.randomUUID(),
        groupId: group.id,
        scope: 'SHARED',
        name: 'Participants',
        target: 'PAID_FOR',
        splitMode: 'EVENLY',
        participants: [{ participant: group.aliceId, shares: 1 }],
      })

      await caller().splitPresets.setGroupDefault({
        groupId: group.id,
        target: 'PAID_BY',
        presetId: paidBy.preset.id,
      })
      await caller().splitPresets.setGroupDefault({
        groupId: group.id,
        target: 'PAID_FOR',
        presetId: paidFor.preset.id,
      })
      await caller().splitPresets.setPersonalDefault({
        groupId: group.id,
        target: 'PAID_FOR',
        choice: { mode: 'PRESET', presetId: paidFor.preset.id },
      })
      await caller(memberId, memberEmail).splitPresets.setPersonalDefault({
        groupId: group.id,
        target: 'PAID_FOR',
        choice: { mode: 'PRESET', presetId: paidFor.preset.id },
      })

      expect(
        (await caller().splitPresets.list({ groupId: group.id })).groupDefaults,
      ).toEqual({
        paidByPresetId: paidBy.preset.id,
        paidForPresetId: paidFor.preset.id,
      })

      await caller().splitPresets.update({
        groupId: group.id,
        presetId: paidFor.preset.id,
        scope: 'SHARED',
        nextScope: 'PERSONAL',
        name: paidFor.preset.name,
        expectedUpdatedAt: paidFor.preset.updatedAt,
        target: 'PAID_FOR',
        splitMode: 'EVENLY',
        participants: [{ participant: group.aliceId, shares: 1 }],
      })

      const adminList = await caller().splitPresets.list({ groupId: group.id })
      expect(adminList.groupDefaults).toEqual({
        paidByPresetId: paidBy.preset.id,
        paidForPresetId: null,
      })
      expect(adminList.personalDefaults.paidFor).toEqual({
        mode: 'PRESET',
        presetId: paidFor.preset.id,
      })
      expect(
        (
          await caller(memberId, memberEmail).splitPresets.list({
            groupId: group.id,
          })
        ).personalDefaults.paidFor,
      ).toEqual({ mode: 'INHERIT', presetId: null })
    } finally {
      await prisma.account.delete({ where: { id: memberId } }).catch(() => {})
    }
  })

  it('coalesces preset rows when participant identities merge', async () => {
    const group = await createGroup(`Preset merge ${runId}`)
    const preset = await caller().splitPresets.create({
      requestId: crypto.randomUUID(),
      groupId: group.id,
      scope: 'SHARED',
      name: 'Merged percentage',
      target: 'PAID_FOR',
      splitMode: 'BY_PERCENTAGE',
      participants: [
        { participant: group.aliceId, shares: 4000 },
        { participant: group.bobId, shares: 6000 },
      ],
    })

    await prisma.$transaction(async (tx) => {
      await mergeLedgerParticipantReferences(tx, {
        sourceId: group.bobId,
        targetId: group.aliceId,
      })
      await tx.ledgerParticipant.delete({ where: { id: group.bobId } })
    })

    expect(
      await prisma.splitPresetParticipant.findMany({
        where: { presetId: preset.preset.id },
        select: { participantId: true, shares: true },
      }),
    ).toEqual([{ participantId: group.aliceId, shares: 10_000 }])
  })
})
