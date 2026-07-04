import { GroupMemberStatus, GroupRole, prisma } from '@spliit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomId } from '../lib/api'
import {
  setDefaultActivityNotificationDispatchers,
  type ActivityNotificationDispatcher,
  type ActivityNotificationEvent,
} from '../lib/notifications/dispatcher'
import { groupsRouter } from '../trpc/routers/groups'
import { findEmailForRecipient, probeMaildev } from './maildev-client'
import { checkDbConnection, testRunId } from './setup'

await checkDbConnection()

// All describe blocks in this file depend on MailDev running locally.
// If the inbox isn't reachable, skip the test (don't fail) so the suite
// stays useful in environments where only the DB is running.
const maildevReachable = await probeMaildev()

describe.skipIf(!maildevReachable)(
  'Import flow — email invitation context',
  () => {
    const runId = testRunId()
    const adminId = `admin-${runId}`
    const adminEmail = `admin-${runId}@test-import.example`
    const inviteeEmail = `invitee-${runId}@test-import.example`

    const accountIds: string[] = [adminId]
    const ledgerIds: string[] = []

    let groupId: string
    let adminLpId: string

    function makeCaller() {
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

      const ledger = await prisma.ledger.create({
        data: { id: randomId(), currency: '$', currencyCode: 'USD' },
      })
      ledgerIds.push(ledger.id)

      const group = await prisma.group.create({
        data: {
          id: randomId(),
          name: `Import-Test-${runId}`,
          ledgerId: ledger.id,
        },
      })
      groupId = group.id

      const adminMember = await prisma.groupMember.create({
        data: {
          id: randomId(),
          groupId,
          accountId: adminId,
          role: GroupRole.ADMIN,
          status: GroupMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      })

      const adminLp = await prisma.ledgerParticipant.create({
        data: {
          id: randomId(),
          ledgerId: ledger.id,
          groupMemberId: adminMember.id,
        },
      })
      adminLpId = adminLp.id
    })

    afterAll(async () => {
      for (const lid of ledgerIds) {
        await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
      }
      for (const aid of accountIds) {
        await prisma.account.delete({ where: { id: aid } }).catch(() => {})
      }
    })

    it('sends an invitation email with import context when importing from SPLIIT', async () => {
      const destLpNew = randomId()

      const result = await makeCaller().import({
        targetGroupId: groupId,
        participants: [
          {
            mode: 'LINK_EXISTING_PARTICIPANT',
            sourceName: 'Admin',
            destLedgerParticipantId: adminLpId,
          },
          {
            mode: 'INVITE_BY_EMAIL',
            sourceName: 'Invited Friend',
            email: inviteeEmail,
            destLedgerParticipantId: destLpNew,
          },
        ],
        expenses: [
          {
            title: 'Dinner',
            amount: 2000,
            expenseDate: new Date('2026-06-01'),
            category: 'general',
            splitMode: 'EVENLY',
            paidBySplitMode: 'BY_AMOUNT',
            paidByList: [{ participant: destLpNew, shares: 2000 }],
            paidFor: [
              { participant: destLpNew, shares: 1 },
              { participant: adminLpId, shares: 1 },
            ],
            isReimbursement: false,
            saveDefaultSplittingOptions: false,
            documents: [],
            recurrenceRule: 'NONE',
          },
          {
            title: 'Lunch',
            amount: 1500,
            expenseDate: new Date('2026-06-02'),
            category: 'general',
            splitMode: 'EVENLY',
            paidBySplitMode: 'BY_AMOUNT',
            paidByList: [{ participant: adminLpId, shares: 1500 }],
            paidFor: [
              { participant: destLpNew, shares: 1 },
              { participant: adminLpId, shares: 1 },
            ],
            isReimbursement: false,
            saveDefaultSplittingOptions: false,
            documents: [],
            recurrenceRule: 'NONE',
          },
        ],
        sourceMeta: {
          provider: 'SPLIIT',
          sourceGroupId: 'src-1',
        },
      })

      expect(result.importedExpenses).toBe(2)
      expect(result.invites).toHaveLength(1)
      expect(result.invites[0].kind).toBe('EMAIL')
      expect(result.invites[0].email).toBe(inviteeEmail.toLowerCase())

      const captured = await findEmailForRecipient(inviteeEmail)
      expect(captured).not.toBeNull()
      expect(captured!.text).toContain('You will appear as "Invited Friend"')
      expect(captured!.text).toContain(
        'This invitation is part of an import from a Spliit export.',
      )
      expect(captured!.text).toContain(
        'The group contains 2 expenses from the import (total USD 35.00)',
      )
    })
  },
)

describe('import summary notification', () => {
  const runId2 = testRunId()
  const adminId2 = `acct-imp2-${runId2}`
  const adminEmail2 = `imp2-${runId2}@test.example`
  const aliceId2 = `acct-imp2-a-${runId2}`
  const aliceEmail2 = `imp2-a-${runId2}@test.example`

  const ledgerIds2: string[] = []
  function trackLedger(id: string) {
    ledgerIds2.push(id)
  }

  class CapturingDispatcher implements ActivityNotificationDispatcher {
    events: ActivityNotificationEvent[] = []
    async dispatch(event: ActivityNotificationEvent): Promise<void> {
      this.events.push(event)
    }
  }

  let capture: CapturingDispatcher

  function makeCaller2(accountId = adminId2, email = adminEmail2) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-test' },
        user: {
          id: accountId,
          email,
          emailVerified: true,
          name: accountId === adminId2 ? 'Test Admin' : 'Alice',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    await prisma.account.upsert({
      where: { email: adminEmail2 },
      update: {},
      create: {
        id: adminId2,
        email: adminEmail2,
        emailVerified: true,
        name: 'Test Admin',
      },
    })
    await prisma.account.upsert({
      where: { email: aliceEmail2 },
      update: {},
      create: {
        id: aliceId2,
        email: aliceEmail2,
        emailVerified: true,
        name: 'Alice',
      },
    })
  })

  afterAll(async () => {
    setDefaultActivityNotificationDispatchers([])
    for (const lid of ledgerIds2) {
      await prisma.ledger.delete({ where: { id: lid } }).catch(() => {})
    }
    await prisma.account.delete({ where: { id: adminId2 } }).catch(() => {})
    await prisma.account.delete({ where: { id: aliceId2 } }).catch(() => {})
  })

  async function createGroup(name: string, addAlice = false) {
    capture = new CapturingDispatcher()
    setDefaultActivityNotificationDispatchers([capture])

    const caller = makeCaller2()
    const result = await caller.create({
      groupFormValues: {
        name,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: result.groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    trackLedger(group!.ledger.id)
    const adminLp = group!.members[0].ledgerParticipant!.id

    let aliceLp: string | undefined
    if (addAlice) {
      const am = await prisma.groupMember.create({
        data: {
          id: randomId(),
          groupId: result.groupId,
          accountId: aliceId2,
          role: GroupRole.MEMBER,
          status: GroupMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      })
      aliceLp = (
        await prisma.ledgerParticipant.create({
          data: {
            id: randomId(),
            ledgerId: group!.ledger.id,
            groupMemberId: am.id,
          },
        })
      ).id
    }

    return {
      groupId: result.groupId,
      ledgerId: group!.ledger.id,
      adminLp,
      aliceLp,
    }
  }

  it('import writes per-expense activities and a single summary notification', async () => {
    const { groupId, ledgerId, adminLp, aliceLp } = await createGroup(
      `Imp-Act-${runId2}`,
      true,
    )

    capture.events.length = 0

    const result = await makeCaller2().import({
      targetGroupId: groupId,
      participants: [
        {
          mode: 'LINK_EXISTING_PARTICIPANT',
          sourceName: 'Admin',
          destLedgerParticipantId: adminLp,
        },
        {
          mode: 'LINK_EXISTING_PARTICIPANT',
          sourceName: 'Alice',
          destLedgerParticipantId: aliceLp!,
        },
      ],
      expenses: [
        {
          title: 'Imported 1',
          amount: 2000,
          expenseDate: new Date('2026-06-01'),
          category: 'general',
          splitMode: 'EVENLY',
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [{ participant: adminLp, shares: 2000 }],
          paidFor: [
            { participant: adminLp, shares: 1 },
            { participant: aliceLp!, shares: 1 },
          ],
          isReimbursement: false,
          saveDefaultSplittingOptions: false,
          documents: [],
          recurrenceRule: 'NONE',
        },
        {
          title: 'Imported 2',
          amount: 1500,
          expenseDate: new Date('2026-06-02'),
          category: 'general',
          splitMode: 'EVENLY',
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [{ participant: aliceLp!, shares: 1500 }],
          paidFor: [
            { participant: adminLp, shares: 1 },
            { participant: aliceLp!, shares: 1 },
          ],
          isReimbursement: false,
          saveDefaultSplittingOptions: false,
          documents: [],
          recurrenceRule: 'NONE',
        },
      ],
      sourceMeta: {
        provider: 'TEST',
        sourceGroupId: 'src-1',
      },
    })
    expect(result.importedExpenses).toBe(2)

    for (const title of ['Imported 1', 'Imported 2']) {
      const expense = await prisma.expense.findFirst({
        where: { ledgerId, title },
      })
      expect(expense).not.toBeNull()
      const activity = await prisma.activity.findFirst({
        where: { subjectId: expense!.id, type: 'EXPENSE_CREATED' },
      })
      expect(activity).not.toBeNull()
      const data = activity!.data as Record<string, unknown>
      expect(data.kind).toBe('expense')
      expect(data.title).toBe(title)
      expect(data.amount).toBe(expense!.amount)
      expect(data.currencyCode).toBe('USD')
    }

    const summaryActivities = await prisma.activity.findMany({
      where: { ledgerId, type: 'EXPENSES_IMPORTED' },
    })
    expect(summaryActivities).toHaveLength(1)
    const summaryData = summaryActivities[0].data as Record<string, unknown>
    expect(summaryData.kind).toBe('import_summary')
    expect(summaryData.count).toBe(2)
    expect(summaryData.totalAmount).toBe(3500)
    expect(summaryData.currencyCode).toBe('USD')
    expect(summaryData.sourceProvider).toBe('TEST')
    expect(summaryData.affectedParticipants).toEqual(
      expect.arrayContaining([adminLp, aliceLp!]),
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    const perExpenseEvents = capture.events.filter(
      (e) => e.type === 'EXPENSE_CREATED',
    )
    const summaryEvents = capture.events.filter(
      (e) => e.type === 'EXPENSES_IMPORTED',
    )
    expect(perExpenseEvents).toHaveLength(0)
    expect(summaryEvents).toHaveLength(1)
    const event = summaryEvents[0]
    expect(event.groupId).toBe(groupId)
    expect(event.subject).toEqual({ type: 'GROUP', id: groupId })
    const eventData = event.data as Record<string, unknown>
    expect(eventData.kind).toBe('import_summary')
    expect(eventData.count).toBe(2)
    expect(eventData.affectedParticipants).toEqual(
      expect.arrayContaining([adminLp, aliceLp!]),
    )
  })
})

// ---------------------------------------------------------------
// Regression: INVITE_BY_EMAIL / INVITE_BY_LINK do not produce
// duplicate participants when paired with LINK_EXISTING_PARTICIPANT
// ---------------------------------------------------------------
describe('Import participant deduplication', () => {
  const runId3 = testRunId()
  const adminId3 = `acct-dedup-${runId3}`
  const adminEmail3 = `dedup-${runId3}@test.example`

  const groupIds: string[] = []

  function makeCaller3(accountId = adminId3, email = adminEmail3) {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-dedup' },
        user: {
          id: accountId,
          email,
          emailVerified: true,
          name: 'Test Admin',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    await prisma.account.upsert({
      where: { email: adminEmail3 },
      update: {},
      create: {
        id: adminId3,
        email: adminEmail3,
        emailVerified: true,
        name: 'Test Admin',
      },
    })
  })

  afterEach(async () => {
    for (const gid of groupIds) {
      const ledger = await prisma.ledger.findFirst({
        where: { group: { id: gid } },
      })
      if (ledger) {
        await prisma.ledgerParticipant
          .deleteMany({ where: { ledgerId: ledger.id } })
          .catch(() => {})
      }
      await prisma.activity
        .deleteMany({ where: { groupId: gid } })
        .catch(() => {})
      await prisma.groupInvitation
        .deleteMany({ where: { groupId: gid } })
        .catch(() => {})
      await prisma.groupMember
        .deleteMany({ where: { groupId: gid } })
        .catch(() => {})
      await prisma.group.delete({ where: { id: gid } }).catch(() => {})
      if (ledger) {
        await prisma.ledger.delete({ where: { id: ledger.id } }).catch(() => {})
      }
    }
    groupIds.length = 0
  })

  afterAll(async () => {
    await prisma.account.delete({ where: { id: adminId3 } }).catch(() => {})
  })

  async function createGroupWithAdmin() {
    const caller = makeCaller3()
    const result = await caller.create({
      groupFormValues: {
        name: `Imp-Dedup-${runId3}`,
        currency: '$',
        currencyCode: 'USD',
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: result.groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    groupIds.push(result.groupId)
    const adminLp = group!.members[0].ledgerParticipant!.id
    return { groupId: result.groupId, ledgerId: group!.ledger.id, adminLp }
  }

  it('INVITE_BY_EMAIL + LINK_EXISTING_PARTICIPANT yields exactly 2 participants', async () => {
    const { groupId, adminLp } = await createGroupWithAdmin()
    const inviteEmail = `invitee-dedup-${runId3}@test.local`
    const inviteDestLpId = randomId()

    await makeCaller3().import({
      targetGroupId: groupId,
      participants: [
        {
          mode: 'LINK_EXISTING_PARTICIPANT',
          sourceName: 'Admin',
          destLedgerParticipantId: adminLp,
        },
        {
          mode: 'INVITE_BY_EMAIL',
          sourceName: 'Invitee',
          email: inviteEmail,
          destLedgerParticipantId: inviteDestLpId,
        },
      ],
      expenses: [
        {
          title: 'Imported expense',
          amount: 1000,
          expenseDate: new Date('2026-06-01'),
          category: 'general',
          splitMode: 'EVENLY',
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [{ participant: adminLp, shares: 1000 }],
          paidFor: [{ participant: adminLp, shares: 1 }],
          isReimbursement: false,
          saveDefaultSplittingOptions: false,
          documents: [],
          recurrenceRule: 'NONE',
        },
      ],
    })

    const result = await makeCaller3().get({ groupId })
    expect(result.group.participants).toHaveLength(2)

    const invitee = result.group.participants.find(
      (p: { unlinked: boolean; pending: boolean }) => !p.unlinked && p.pending,
    )
    expect(invitee).toBeDefined()

    const invitation = await prisma.groupInvitation.findFirst({
      where: { groupId, email: inviteEmail.toLowerCase() },
    })
    expect(invitation).not.toBeNull()
    expect(invitation!.ledgerParticipantId).not.toBeNull()
    expect(invitation!.ledgerParticipantId).toBe(invitee!.id)
  })

  it('INVITE_BY_LINK + LINK_EXISTING_PARTICIPANT yields exactly 2 participants', async () => {
    const { groupId, adminLp } = await createGroupWithAdmin()
    const invitePlaceholderLpId = randomId()

    await makeCaller3().import({
      targetGroupId: groupId,
      participants: [
        {
          mode: 'LINK_EXISTING_PARTICIPANT',
          sourceName: 'Admin',
          destLedgerParticipantId: adminLp,
        },
        {
          mode: 'INVITE_BY_LINK',
          sourceName: 'Invitee',
          destLedgerParticipantId: invitePlaceholderLpId,
        },
      ],
      expenses: [
        {
          title: 'Imported expense',
          amount: 1000,
          expenseDate: new Date('2026-06-01'),
          category: 'general',
          splitMode: 'EVENLY',
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [{ participant: adminLp, shares: 1000 }],
          paidFor: [{ participant: adminLp, shares: 1 }],
          isReimbursement: false,
          saveDefaultSplittingOptions: false,
          documents: [],
          recurrenceRule: 'NONE',
        },
      ],
    })

    const result = await makeCaller3().get({ groupId })
    expect(result.group.participants).toHaveLength(2)

    const linkInvitation = await prisma.groupInvitation.findFirst({
      where: { groupId, type: 'LINK' },
    })
    expect(linkInvitation).not.toBeNull()
    expect(linkInvitation!.ledgerParticipantId).not.toBeNull()
    expect(linkInvitation!.ledgerParticipantId).toBe(invitePlaceholderLpId)
  })
})

describe('Import summary — totalAmount excludes reimbursements', () => {
  const runId4 = testRunId()
  const adminId4 = `acct-total-${runId4}`
  const adminEmail4 = `total-${runId4}@test.example`

  const groupIds: string[] = []

  function makeCaller4() {
    return groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-total' },
        user: {
          id: adminId4,
          email: adminEmail4,
          emailVerified: true,
          name: 'Test Admin',
        },
      },
    } as never)
  }

  beforeAll(async () => {
    await prisma.account.upsert({
      where: { email: adminEmail4 },
      update: {},
      create: {
        id: adminId4,
        email: adminEmail4,
        emailVerified: true,
        name: 'Test Admin',
      },
    })
  })

  afterEach(async () => {
    for (const gid of groupIds) {
      const ledger = await prisma.ledger.findFirst({
        where: { group: { id: gid } },
      })
      if (ledger) {
        await prisma.ledgerParticipant
          .deleteMany({ where: { ledgerId: ledger.id } })
          .catch(() => {})
      }
      await prisma.activity
        .deleteMany({ where: { groupId: gid } })
        .catch(() => {})
      await prisma.groupInvitation
        .deleteMany({ where: { groupId: gid } })
        .catch(() => {})
      await prisma.groupMember
        .deleteMany({ where: { groupId: gid } })
        .catch(() => {})
      await prisma.expense
        .deleteMany({ where: { groupId: gid } })
        .catch(() => {})
      await prisma.group.delete({ where: { id: gid } }).catch(() => {})
      if (ledger) {
        await prisma.ledger.delete({ where: { id: ledger.id } }).catch(() => {})
      }
    }
    groupIds.length = 0
  })

  afterAll(async () => {
    await prisma.account.delete({ where: { id: adminId4 } }).catch(() => {})
  })

  async function createGroupWithAdmin(currencyCode = 'EUR') {
    const caller = makeCaller4()
    const result = await caller.create({
      groupFormValues: {
        name: `Imp-Total-${runId4}`,
        currency: currencyCode === 'EUR' ? '€' : '$',
        currencyCode,
        participants: [{ name: 'Admin' }],
      },
    })
    const group = await prisma.group.findUnique({
      where: { id: result.groupId },
      include: {
        ledger: true,
        members: { include: { ledgerParticipant: true } },
      },
    })
    groupIds.push(result.groupId)
    const adminLp = group!.members[0].ledgerParticipant!.id
    return { groupId: result.groupId, ledgerId: group!.ledger.id, adminLp }
  }

  function makeExpense(opts: {
    title: string
    amount: number
    isReimbursement: boolean
    adminLp: string
  }) {
    return {
      title: opts.title,
      amount: opts.amount,
      expenseDate: new Date('2026-06-01'),
      category: 'general',
      splitMode: 'EVENLY' as const,
      paidBySplitMode: 'BY_AMOUNT' as const,
      paidByList: [{ participant: opts.adminLp, shares: opts.amount }],
      paidFor: [{ participant: opts.adminLp, shares: 1 }],
      isReimbursement: opts.isReimbursement,
      saveDefaultSplittingOptions: false,
      documents: [],
      recurrenceRule: 'NONE' as const,
    }
  }

  it('totalAmount excludes reimbursement expenses so it matches Total group spendings', async () => {
    const { groupId, ledgerId, adminLp } = await createGroupWithAdmin('EUR')

    await makeCaller4().import({
      targetGroupId: groupId,
      participants: [
        {
          mode: 'LINK_EXISTING_PARTICIPANT',
          sourceName: 'Admin',
          destLedgerParticipantId: adminLp,
        },
      ],
      expenses: [
        makeExpense({
          title: 'Dinner',
          amount: 3000,
          isReimbursement: false,
          adminLp,
        }),
        makeExpense({
          title: 'Lunch',
          amount: 1500,
          isReimbursement: false,
          adminLp,
        }),
        // Settlement from previous balance — should NOT be counted in spending total
        makeExpense({
          title: 'Settlement from Bob',
          amount: 5192,
          isReimbursement: true,
          adminLp,
        }),
      ],
    })

    const summaryActivities = await prisma.activity.findMany({
      where: { ledgerId, type: 'EXPENSES_IMPORTED' },
    })
    expect(summaryActivities).toHaveLength(1)
    const summaryData = summaryActivities[0].data as Record<string, unknown>
    expect(summaryData.kind).toBe('import_summary')
    // count includes the reimbursement (76 in the user's report); totalAmount does not
    expect(summaryData.count).toBe(3)
    expect(summaryData.totalAmount).toBe(4500)
    expect(summaryData.currencyCode).toBe('EUR')
  })

  it('totalAmount equals sum of all expenses when none are reimbursements', async () => {
    const { groupId, ledgerId, adminLp } = await createGroupWithAdmin('EUR')

    await makeCaller4().import({
      targetGroupId: groupId,
      participants: [
        {
          mode: 'LINK_EXISTING_PARTICIPANT',
          sourceName: 'Admin',
          destLedgerParticipantId: adminLp,
        },
      ],
      expenses: [
        makeExpense({
          title: 'Coffee',
          amount: 500,
          isReimbursement: false,
          adminLp,
        }),
        makeExpense({
          title: 'Brunch',
          amount: 2500,
          isReimbursement: false,
          adminLp,
        }),
      ],
    })

    const summaryActivities = await prisma.activity.findMany({
      where: { ledgerId, type: 'EXPENSES_IMPORTED' },
    })
    const summaryData = summaryActivities[0].data as Record<string, unknown>
    expect(summaryData.totalAmount).toBe(3000)
  })

  it('totalAmount is zero when all expenses are reimbursements', async () => {
    const { groupId, ledgerId, adminLp } = await createGroupWithAdmin('EUR')

    await makeCaller4().import({
      targetGroupId: groupId,
      participants: [
        {
          mode: 'LINK_EXISTING_PARTICIPANT',
          sourceName: 'Admin',
          destLedgerParticipantId: adminLp,
        },
      ],
      expenses: [
        makeExpense({
          title: 'Settlement 1',
          amount: 1000,
          isReimbursement: true,
          adminLp,
        }),
        makeExpense({
          title: 'Settlement 2',
          amount: 2000,
          isReimbursement: true,
          adminLp,
        }),
      ],
    })

    const summaryActivities = await prisma.activity.findMany({
      where: { ledgerId, type: 'EXPENSES_IMPORTED' },
    })
    const summaryData = summaryActivities[0].data as Record<string, unknown>
    expect(summaryData.count).toBe(2)
    expect(summaryData.totalAmount).toBe(0)
  })
})
