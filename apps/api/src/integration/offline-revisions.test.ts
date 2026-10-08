import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '@spliit/db'

import { parseOfflineRevisionToken } from '../trpc/outputs/offline'
import { groupsRouter } from '../trpc/routers/groups'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

/**
 * Offline revision tokens against a real database.
 *
 * Proves the PostgreSQL triggers behind `Group.offlineContentRevision` and
 * `AccountGroupPreference.offlineViewerRevision` fire for every snapshot
 * dependency category (and only there), advance exactly once per write, and
 * compose into coherent catalog/snapshot tokens. Requires the integration
 * database; fails at load when unreachable.
 */
describe('Offline revision tokens — real DB', () => {
  const runId = testRunId()
  const adminId = `acct-offrev-${runId}`
  const adminEmail = `offrev-${runId}@test.example`
  const peerId = `acct-offrev-peer-${runId}`
  const peerEmail = `offrev-peer-${runId}@test.example`

  const ledgerIds: string[] = []
  let groupId = ''
  let ledgerId = ''
  let expenseId = ''

  function makeCaller(accountId = adminId, email = adminEmail) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: { id: accountId, email, emailVerified: true, name: 'Offline' },
      },
    } as never)
  }

  async function catalogToken(accountId = adminId): Promise<string> {
    const catalog = await makeCaller(
      accountId,
      accountId === adminId ? adminEmail : peerEmail,
    ).offlineCatalog()
    const entry = catalog.groups.find((g) => g.overview.id === groupId)
    expect(entry).toBeDefined()
    return entry!.revision
  }

  function parts(token: string) {
    const parsed = parseOfflineRevisionToken(token)
    expect(parsed).not.toBeNull()
    return parsed!
  }

  beforeAll(async () => {
    for (const [id, email] of [
      [adminId, adminEmail],
      [peerId, peerEmail],
    ] as const) {
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: { id, email, emailVerified: true, name: 'Offline' },
      })
    }
    const { groupId: created } = await makeCaller().create({
      requestId: crypto.randomUUID(),
      groupFormValues: {
        name: 'Revision group',
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    groupId = created
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      include: { ledger: true },
    })
    ledgerId = group.ledger.id
    ledgerIds.push(ledgerId)
    // Second member so viewer isolation has a peer to compare against.
    const peerMember = await prisma.groupMember.create({
      data: {
        id: `gm-rev-peer-${runId}`,
        groupId,
        accountId: peerId,
        role: 'MEMBER',
        status: 'ACTIVE',
      },
    })
    await prisma.ledgerParticipant.create({
      data: {
        id: `lp-rev-peer-${runId}`,
        ledgerId,
        groupMemberId: peerMember.id,
      },
    })
  })

  afterAll(async () => {
    for (const lid of ledgerIds) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.user.delete({ where: { id: adminId } }).catch(() => {})
    await prisma.user.delete({ where: { id: peerId } }).catch(() => {})
  })

  it('keeps a stable token across reads without writes', async () => {
    expect(await catalogToken()).toBe(await catalogToken())
  })

  it('bumps exactly once per content write across every dependency category', async () => {
    // Expense core.
    expenseId = `exp-rev-${runId}`
    let before = parts(await catalogToken())
    await prisma.expense.create({
      data: {
        id: expenseId,
        ledgerId,
        expenseDate: new Date(),
        expenseTimeZone: 'UTC',
        title: 'Revision expense',
        amount: 1000,
      },
    })
    let after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    // Expense update.
    before = after
    await prisma.expense.update({
      where: { id: expenseId },
      data: { title: 'Revision expense v2' },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    // Allocations.
    before = after
    const participant = await prisma.ledgerParticipant.findFirstOrThrow({
      where: { ledgerId },
    })
    await prisma.expensePaidFor.create({
      data: {
        expenseId,
        ledgerParticipantId: participant.id,
        shares: 100,
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    await prisma.expensePaidFor.delete({
      where: {
        expenseId_ledgerParticipantId: {
          expenseId,
          ledgerParticipantId: participant.id,
        },
      },
    })

    // Items and item shares.
    before = parts(await catalogToken())
    const item = await prisma.expenseItem.create({
      data: {
        id: `item-rev-${runId}`,
        expenseId,
        title: 'Item',
        unitPrice: 500,
        quantity: 2,
        amount: 1000,
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.expenseItemPaidFor.create({
      data: {
        expenseItemId: item.id,
        ledgerParticipantId: participant.id,
        shares: 100,
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    // Document metadata (URLs never enter the payload, but the row does).
    before = after
    const doc = await prisma.expenseDocument.create({
      data: {
        id: `doc-rev-${runId}`,
        url: 'https://example.com/receipt.jpg',
        ledgerId,
        expenseId,
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    // Recurrence series.
    before = after
    await prisma.recurringExpenseSeries.create({
      data: {
        id: `series-rev-${runId}`,
        ledgerId,
        timeZone: 'UTC',
        anchorTimeMinutes: 720,
        frequency: 'MONTHLY',
        interval: 1,
        anchorDate: new Date(),
        nextOccurrenceDate: new Date(),
        template: {},
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    // Group and ledger config.
    before = after
    await prisma.group.update({
      where: { id: groupId },
      data: { name: 'Revision group v2' },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.ledger.update({
      where: { id: ledgerId },
      data: { currencyCode: 'EUR' },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    await prisma.ledger.update({
      where: { id: ledgerId },
      data: { currencyCode: 'USD' },
    })

    // Members, invitations, participants.
    before = parts(await catalogToken())
    await prisma.groupMember.update({
      where: { groupId_accountId: { groupId, accountId: peerId } },
      data: { role: 'ADMIN' },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.groupInvitation.create({
      data: {
        id: `inv-rev-${runId}`,
        groupId,
        email: `invite-${runId}@test.example`,
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.ledgerParticipant.update({
      where: { id: participant.id },
      data: { removedAt: new Date() },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    await prisma.ledgerParticipant.update({
      where: { id: participant.id },
      data: { removedAt: null },
    })

    // Subgroups and presets.
    before = parts(await catalogToken())
    const subgroup = await prisma.subgroup.create({
      data: { id: `sg-rev-${runId}`, groupId, name: 'Trip' },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.subgroupMember.create({
      data: {
        subgroupId: subgroup.id,
        ledgerParticipantId: participant.id,
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    const preset = await prisma.splitPreset.create({
      data: {
        id: `preset-rev-${runId}`,
        groupId,
        scopeKey: 'GROUP',
        name: 'Equal',
        nameKey: 'equal',
        target: 'PAID_FOR',
        splitMode: 'EVENLY',
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.splitPresetParticipant.create({
      data: {
        presetId: preset.id,
        participantId: participant.id,
        shares: 100,
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    // Referenced account display data fans out to member groups.
    before = after
    await prisma.user.update({
      where: { id: peerId },
      data: { name: 'Renamed Peer' },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    // Comments, budgets, alerts, and feed activities (v2 snapshot sections).
    // Each write bumps exactly once; explicit deletes keep the later
    // expense-cascade delete at exactly one bump.
    before = after
    const comment = await prisma.expenseComment.create({
      data: {
        id: `cmt-rev-${runId}`,
        expenseId,
        authorAccountId: peerId,
        authorName: 'Peer',
        text: 'Nice split',
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.expenseComment.delete({ where: { id: comment.id } })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    before = after
    const budget = await prisma.groupBudget.create({
      data: {
        id: `bud-rev-${runId}`,
        groupId,
        ledgerId,
        name: 'Groceries',
        amount: 50000,
        period: 'MONTHLY',
        timeZone: 'UTC',
        createdByAccountId: adminId,
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    const alert = await prisma.groupBudgetAlert.create({
      data: {
        id: `alert-rev-${runId}`,
        budgetId: budget.id,
        periodStart: new Date('2026-01-01T00:00:00Z'),
        alertType: 'OVER',
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.groupBudgetAlert.delete({ where: { id: alert.id } })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.groupBudget.delete({ where: { id: budget.id } })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    before = after
    const activity = await prisma.activity.create({
      data: {
        id: `act-rev-${runId}`,
        ledgerId,
        type: 'GROUP_UPDATED',
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.activity.delete({ where: { id: activity.id } })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )

    // Expense delete still bumps (no silent resurrection window). Children
    // are removed explicitly first so the final delete measures exactly one
    // bump instead of cascade arithmetic.
    before = after
    await prisma.expenseItemPaidFor.delete({
      where: {
        expenseItemId_ledgerParticipantId: {
          expenseItemId: item.id,
          ledgerParticipantId: participant.id,
        },
      },
    })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.expenseItem.delete({ where: { id: item.id } })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.expenseDocument.delete({ where: { id: doc.id } })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
    before = after
    await prisma.expense.delete({ where: { id: expenseId } })
    after = parts(await catalogToken())
    expect(BigInt(after.contentRevision) - BigInt(before.contentRevision)).toBe(
      1n,
    )
  })

  it('isolates viewer revisions while sharing content revisions', async () => {
    const adminToken = parts(await catalogToken(adminId))
    const peerToken = parts(await catalogToken(peerId))
    expect(adminToken.contentRevision).toBe(peerToken.contentRevision)

    await prisma.accountGroupPreference.upsert({
      where: { accountId_groupId: { accountId: adminId, groupId } },
      update: { starred: true },
      create: {
        id: `pref-rev-${runId}`,
        accountId: adminId,
        groupId,
        starred: true,
      },
    })
    const adminAfter = parts(await catalogToken(adminId))
    const peerAfter = parts(await catalogToken(peerId))
    // Same content, viewer part moved only for the starring account.
    expect(adminAfter.contentRevision).toBe(peerAfter.contentRevision)
    expect(adminAfter.contentRevision).toBe(adminToken.contentRevision)
    expect(adminAfter.viewerRevision).not.toBe(adminToken.viewerRevision)
    expect(peerAfter.viewerRevision).toBe(peerToken.viewerRevision)
  })

  it('returns the catalog token coherently from the snapshot', async () => {
    const token = await catalogToken()
    const snapshot = await makeCaller().offlineSnapshot({ groupId })
    expect(snapshot.revision).toBe(token)
  })
})
