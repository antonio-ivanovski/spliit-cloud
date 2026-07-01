// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { describe, expect, it } from 'vitest'
import '../../../test/mocks'
import {
  importGroup,
  type ImportInput,
  linkUnlinkedParticipantToAccount,
  listUnlinkedParticipants,
} from '../../../lib/api'
import { prisma$Transaction, prismaMock } from '../../../test/state'
import { groupsRouter } from './index'

function _makeCaller(authUserId: string) {
  return {
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: authUserId,
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never
}

async function authAs(userId: string) {
  prismaMock.account.findUnique.mockImplementation(async (args: unknown) => {
    const id = (args as { where: { id: string } }).where.id
    return {
      id,
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    }
  })
  prismaMock.account.findUnique.mockResolvedValue({
    id: userId,
    email: 'alice@example.com',
    emailVerified: true,
    name: 'Alice',
  } as never)
  // Per-transaction getMemberLedgerParticipantId reads groupMember,
  // so the helper that importGroup relies on needs a stub here.
  prismaMock.groupMember.findUnique.mockResolvedValue(null as never)
  return { authUserId: userId }
}

function stubGroupWithLedger(groupId = 'grp-1', ledgerId = 'ledger-1'): void {
  // Default the group lookup to a group with a ledger so logActivity
  // (and anything else that calls group.findUnique) sees a real
  // ledgerId. Tests that want a different group/ledger shape can
  // re-mock afterward.
  prismaMock.group.findUnique.mockImplementation(async () => {
    return {
      id: groupId,
      name: 'Imported',
      information: null,
      createdAt: new Date(),
      archived: false,
      ledgerId,
      ledger: { id: ledgerId, currency: '€', currencyCode: 'EUR' },
    } as never
  })
}

const baseExpense = {
  expenseDate: new Date('2025-11-15T00:00:00.000Z'),
  title: 'Dures Bari',
  category: 'transportation',
  amount: 23000,
  // The web wizard supplies destination LedgerParticipant ids in
  // `paidByList[].participant` / `paidFor[].participant`; the server
  // rewrites them through the mapping table in case a LINK_ACCOUNT row
  // reuses an existing member's participant.
  paidBySplitMode: 'BY_AMOUNT',
  paidByList: [{ participant: 'dest-lp-1', shares: 23000 }],
  paidFor: [
    { participant: 'dest-lp-1', shares: 13800 },
    { participant: 'dest-lp-2', shares: 9200 },
  ],
  splitMode: 'BY_AMOUNT',
  saveDefaultSplittingOptions: false,
  isReimbursement: false,
  documents: [],
  recurrenceRule: 'NONE',
} as const

const baseParticipants = [
  {
    mode: 'UNLINKED_PARTICIPANT' as const,
    sourceName: 'John',
    destLedgerParticipantId: 'dest-lp-1',
  },
  {
    mode: 'UNLINKED_PARTICIPANT' as const,
    sourceName: 'Jane',
    destLedgerParticipantId: 'dest-lp-2',
  },
]

describe('importGroup', () => {
  it('creates a new group when groupFormValues is supplied and the destination id is fresh', async () => {
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')

    const calls: Array<{ model: string; op: string }> = []
    prismaMock.group.create.mockImplementation(async () => {
      calls.push({ model: 'group', op: 'create' })
      return {
        id: 'dest-grp',
        name: 'Imported',
        information: null,
        archived: false,
        createdAt: new Date(),
        ledgerId: 'dest-ledger',
      } as never
    })
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'dest-gm',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    prismaMock.expense.create.mockResolvedValue({} as never)

    const input: ImportInput = {
      groupFormValues: {
        name: 'Imported',
        information: '',
        currency: '€',
        currencyCode: 'EUR',
        participants: [{ name: 'Owner' }],
      },
      participants: [...baseParticipants],
      expenses: [baseExpense as never],
      sourceMeta: {
        provider: 'SPLIIT',
        sourceGroupId: 'src-grp',
        sourceUrl: 'https://spliit.app/groups/src-grp',
      },
    }

    const result = await importGroup(input, {
      accountId: 'acct-importer',
    })

    expect(result.groupId).toBe('dest-grp')
    expect(result.ledgerId).toBe('dest-ledger')
    expect(result.importedExpenses).toBe(1)
    expect(result.sourceGroupId).toBe('src-grp')
    expect(calls.some((c) => c.model === 'group')).toBe(true)
    // Destination id is the freshly-generated id, not the source id.
    expect(result.groupId).not.toBe(input.sourceMeta?.sourceGroupId)
  })

  it('writes expenses pointing at the supplied destLedgerParticipantId (no foreign-key violation)', async () => {
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'dest-gm',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    const expenseCreates: Array<{ data: unknown }> = []
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      expenseCreates.push(args as { data: unknown })
      return {} as never
    })
    await importGroup(
      {
        groupFormValues: {
          name: 'Imported',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
          participants: [{ name: 'Owner' }],
        },
        participants: [...baseParticipants],
        expenses: [baseExpense as never],
      },
      { accountId: 'acct-importer' },
    )
    expect(expenseCreates).toHaveLength(1)
    const data = expenseCreates[0].data as {
      paidBySplitMode: string
      paidByList: {
        createMany: { data: Array<{ ledgerParticipantId: string }> }
      }
      paidFor: { createMany: { data: Array<{ ledgerParticipantId: string }> } }
    }
    // The paidByList on the expense must point at one of the
    // destLedgerParticipantId values we sent in. The pre-fix bug
    // surfaced here as a 500 (foreign-key violation) because the
    // web-supplied id was being passed straight to the database
    // without any resolve step.
    expect(data.paidBySplitMode).toBe('BY_AMOUNT')
    expect(
      data.paidByList.createMany.data.map((d) => d.ledgerParticipantId),
    ).toEqual(['dest-lp-1'])
    const paidForIds = data.paidFor.createMany.data.map(
      (d) => d.ledgerParticipantId,
    )
    expect(paidForIds).toEqual(['dest-lp-1', 'dest-lp-2'])
  })

  it('creates a fresh LedgerParticipant for the LINK_ACCOUNT target (admin has no LP yet)', async () => {
    // New-group flow: the importer is added as ADMIN/ACTIVE without
    // a LedgerParticipant (LP is created lazily — see the import
    // commit). When the LINK_ACCOUNT mapping targets the importer,
    // the mapping loop creates the LP with the supplied
    // `destLedgerParticipantId` and links it to the existing admin
    // GroupMember. Expense refs point at this fresh id.
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    prismaMock.groupMember.create.mockImplementation(async (args: unknown) => {
      return {
        id: 'dest-gm',
        groupId: 'dest-grp',
        accountId: (args as { data: { accountId: string } }).data.accountId,
        role: 'ADMIN',
        status: 'ACTIVE',
      } as never
    })
    // Mock the existingMember lookup: admin exists, but
    // ledgerParticipant is null (the LP is created lazily).
    prismaMock.groupMember.findUnique.mockResolvedValue({
      id: 'dest-gm',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
      ledgerParticipant: null,
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    const expenseCreates: Array<{ data: unknown }> = []
    prismaMock.expense.create.mockImplementation(async (args: unknown) => {
      expenseCreates.push(args as { data: unknown })
      return {} as never
    })
    await importGroup(
      {
        groupFormValues: {
          name: 'Imported',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
          participants: [{ name: 'Owner' }],
        },
        participants: [
          {
            mode: 'LINK_ACCOUNT',
            sourceName: 'John',
            linkedAccountId: 'acct-importer',
            destLedgerParticipantId: 'web-supplied-lp',
          },
          {
            mode: 'UNLINKED_PARTICIPANT',
            sourceName: 'Jane',
            destLedgerParticipantId: 'dest-lp-2',
          },
        ],
        expenses: [
          {
            expenseDate: new Date('2025-11-15'),
            title: 'Dinner',
            category: 'general',
            amount: 10000,
            paidBySplitMode: 'BY_AMOUNT',
            paidByList: [{ participant: 'web-supplied-lp', shares: 10000 }],
            paidFor: [{ participant: 'dest-lp-2', shares: 5000 }],
            splitMode: 'BY_AMOUNT',
            saveDefaultSplittingOptions: false,
            isReimbursement: false,
            documents: [],
            recurrenceRule: 'NONE',
          },
        ],
      },
      { accountId: 'acct-importer' },
    )
    expect(expenseCreates).toHaveLength(1)
    const data = expenseCreates[0].data as {
      paidByList: {
        createMany: { data: Array<{ ledgerParticipantId: string }> }
      }
      paidFor: { createMany: { data: Array<{ ledgerParticipantId: string }> } }
    }
    // The LINK_ACCOUNT branch created a fresh LP with the
    // web-supplied `destLedgerParticipantId` for John, linked to
    // the existing admin GroupMember. The expense's paidByList
    // points at this fresh id (not at a server-generated LP for
    // the admin).
    expect(
      data.paidByList.createMany.data.map((d) => d.ledgerParticipantId),
    ).toEqual(['web-supplied-lp'])
  })

  it('does not create a LedgerParticipant for the admin when no source row maps to it', async () => {
    // New-group flow with every source participant mapped to
    // UNLINKED_PARTICIPANT. The admin GroupMember is created
    // (the user owns the group), but no LedgerParticipant is
    // materialized for them — that would surface the admin as an
    // orphan row in the balances list (with the account name
    // potentially colliding with a source participant of the
    // same name). The LP is created lazily on the first
    // LINK_ACCOUNT reuse or the first expense that needs it.
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    const ledgerParticipantCreates: Array<unknown> = []
    prismaMock.ledgerParticipant.create.mockImplementation(
      async (args: unknown) => {
        ledgerParticipantCreates.push(args)
        return {} as never
      },
    )
    prismaMock.expense.create.mockResolvedValue({} as never)
    await importGroup(
      {
        groupFormValues: {
          name: 'Imported',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
          participants: [{ name: 'Owner' }],
        },
        participants: [
          {
            mode: 'UNLINKED_PARTICIPANT',
            sourceName: 'John',
            destLedgerParticipantId: 'dest-lp-1',
          },
          {
            mode: 'UNLINKED_PARTICIPANT',
            sourceName: 'Jane',
            destLedgerParticipantId: 'dest-lp-2',
          },
        ],
        expenses: [],
      },
      { accountId: 'acct-importer' },
    )
    // Two LP creates (one per UNLINKED row). The admin's LP is
    // NOT created — otherwise the admin would show up as a
    // duplicate row in the balances list when their account name
    // matches a source participant's name.
    expect(ledgerParticipantCreates).toHaveLength(2)
    for (const args of ledgerParticipantCreates) {
      const data = (args as { data: unknown }).data as {
        groupMemberId?: string
      }
      // No LP created with a groupMemberId (i.e. none linked to
      // the admin GroupMember).
      expect(data.groupMemberId).toBeUndefined()
    }
  })

  it('throws when two paidFor entries resolve to the same destination LedgerParticipant', async () => {
    // The wizard prevents two source rows from mapping to the same
    // destination account, but if the constraint is ever bypassed
    // (direct API access, future mapping bug), the server must
    // FAIL LOUDLY rather than silently merging the duplicates.
    // Silent merges mask data corruption — the user can never tell
    // their shares got summed together.
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'dest-gm',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    prismaMock.expense.create.mockResolvedValue({} as never)
    await expect(
      importGroup(
        {
          groupFormValues: {
            name: 'Imported',
            information: '',
            currency: '€',
            currencyCode: 'EUR',
            participants: [{ name: 'Owner' }],
          },
          participants: [
            {
              mode: 'UNLINKED_PARTICIPANT',
              sourceName: 'John',
              destLedgerParticipantId: 'dest-lp-1',
            },
            {
              mode: 'UNLINKED_PARTICIPANT',
              sourceName: 'Jane',
              destLedgerParticipantId: 'dest-lp-2',
            },
          ],
          // Two paidFor entries target the same destination id
          // (`dest-lp-1`). This is the state the wizard blocks; the
          // server must surface it as a clear error rather than
          // silently merge.
          expenses: [
            {
              expenseDate: new Date('2025-11-15'),
              title: 'Dinner',
              category: 'general',
              amount: 6000,
              paidBySplitMode: 'BY_AMOUNT',
              paidByList: [{ participant: 'dest-lp-1', shares: 6000 }],
              paidFor: [
                { participant: 'dest-lp-1', shares: 4000 },
                { participant: 'dest-lp-2', shares: 2000 },
                { participant: 'dest-lp-1', shares: 0 },
              ],
              splitMode: 'BY_AMOUNT',
              saveDefaultSplittingOptions: false,
              isReimbursement: false,
              documents: [],
              recurrenceRule: 'NONE',
            },
          ],
        },
        { accountId: 'acct-importer' },
      ),
    ).rejects.toThrow(/two paidFor entries for the same LedgerParticipant/i)
  })

  it('rejects when only targetGroupId is supplied and the group is missing', async () => {
    await authAs('acct-importer')
    prismaMock.group.findUnique.mockResolvedValue(null as never)
    await expect(
      importGroup(
        {
          targetGroupId: 'grp-missing',
          participants: baseParticipants,
          expenses: [],
        },
        { accountId: 'acct-importer' },
      ),
    ).rejects.toThrow(/not found/i)
  })

  it('rejects when neither targetGroupId nor groupFormValues is supplied', async () => {
    await authAs('acct-importer')
    await expect(
      importGroup(
        { participants: baseParticipants, expenses: [] },
        { accountId: 'acct-importer' },
      ),
    ).rejects.toThrow(/required/i)
  })

  it('writes an import activity entry referencing the source id', async () => {
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'dest-gm',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)

    const activityCreates: Array<{ data: unknown }> = []
    prismaMock.activity.create.mockImplementation(async (args: unknown) => {
      activityCreates.push(args as { data: unknown })
      return {} as never
    })

    await importGroup(
      {
        groupFormValues: {
          name: 'Imported',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
          participants: [{ name: 'Owner' }],
        },
        participants: baseParticipants,
        expenses: [],
        sourceMeta: {
          provider: 'SPLIIT',
          sourceGroupId: 'src-original',
        },
      },
      { accountId: 'acct-importer' },
    )

    const importActivity = activityCreates.find(
      (a) =>
        typeof (a.data as { data?: string }).data === 'string' &&
        ((a.data as { data?: string }).data ?? '').startsWith('Imported from'),
    )
    expect(importActivity).toBeDefined()
    expect((importActivity!.data as { data: string }).data).toContain('SPLIIT')
    expect((importActivity!.data as { data: string }).data).toContain(
      'src-original',
    )
  })

  it('uses the $transaction wrapper so the commit is atomic', async () => {
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')
    let usedTransaction = false
    prisma$Transaction.mockImplementationOnce(async (input: unknown) => {
      usedTransaction = true
      if (typeof input === 'function') {
        return (input as (tx: unknown) => unknown)(prismaMock)
      }
      return undefined
    })
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'dest-gm',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    await importGroup(
      {
        groupFormValues: {
          name: 'Imported',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
          participants: [{ name: 'Owner' }],
        },
        participants: baseParticipants,
        expenses: [],
      },
      { accountId: 'acct-importer' },
    )
    expect(usedTransaction).toBe(true)
  })

  it('materializes INVITE_BY_LINK rows as unlinked participants and surfaces the shareable link in the result', async () => {
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'dest-gm',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
    } as never)
    prismaMock.groupInvitation.create.mockResolvedValue({
      id: 'inv-1',
    } as never)
    // INVITE_BY_LINK mappings should NOT throw despite the email
    // send path being absent for this kind; only the LINK path
    // produces an inviteUrl in the response.
    const result = await importGroup(
      {
        groupFormValues: {
          name: 'Imported',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
          participants: [{ name: 'Owner' }],
        },
        participants: [
          {
            mode: 'LINK_ACCOUNT',
            sourceName: 'John',
            linkedAccountId: 'acct-importer',
          },
          { mode: 'INVITE_BY_LINK', sourceName: 'Jane' },
        ],
        expenses: [],
      },
      { accountId: 'acct-importer' },
    )
    // The commit produced the unlinked participant + the admin's
    // account-backed participant. The shareable-link invite is
    // produced after the commit and surfaced in the result for the
    // wizard to display. (The token/url is generated by
    // createLinkInvitation; here we just verify the structure.)
    expect(result.invites).toBeDefined()
  })

  it('throws when target group is archived', async () => {
    await authAs('acct-importer')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-archived',
      ledgerId: 'ledger-1',
      archived: true,
    } as never)
    await expect(
      importGroup(
        {
          targetGroupId: 'grp-archived',
          participants: baseParticipants,
          expenses: [],
        },
        { accountId: 'acct-importer' },
      ),
    ).rejects.toThrow(/Cannot import into an archived group/i)
  })

  it('throws when target group is missing its ledger', async () => {
    await authAs('acct-importer')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-no-ledger',
      ledgerId: null,
      archived: false,
    } as never)
    await expect(
      importGroup(
        {
          targetGroupId: 'grp-no-ledger',
          participants: baseParticipants,
          expenses: [],
        },
        { accountId: 'acct-importer' },
      ),
    ).rejects.toThrow(/is missing its ledger/i)
  })

  it('throws when LINK_ACCOUNT linked account does not exist', async () => {
    await authAs('acct-importer')
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'dest-grp',
      ledgerId: 'ledger-1',
      archived: false,
    } as never)
    // The mapping loop queries existing LedgerParticipants to
    // validate LINK_EXISTING_PARTICIPANT refs. Stub as empty.
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)
    // Override the account mock so the linked account lookup returns null
    prismaMock.account.findUnique.mockResolvedValue(null as never)
    await expect(
      importGroup(
        {
          targetGroupId: 'dest-grp',
          participants: [
            {
              mode: 'LINK_ACCOUNT',
              sourceName: 'John',
              linkedAccountId: 'non-existent-acct',
              destLedgerParticipantId: 'dest-lp-1',
            },
          ],
          expenses: [],
        },
        { accountId: 'acct-importer' },
      ),
    ).rejects.toThrow(/Linked account not found/i)
  })

  it('throws when all paidFor entries resolve to nothing', async () => {
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Imported',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'dest-gm',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    await expect(
      importGroup(
        {
          groupFormValues: {
            name: 'Imported',
            information: '',
            currency: '€',
            currencyCode: 'EUR',
            participants: [{ name: 'Owner' }],
          },
          participants: [...baseParticipants],
          expenses: [
            {
              ...baseExpense,
              paidFor: [{ participant: 'non-existent', shares: 10000 }],
            } as never,
          ],
        },
        { accountId: 'acct-importer' },
      ),
    ).rejects.toThrow(/has no remaining paidFor participants/i)
  })
})

describe('importGroup (tRPC caller)', () => {
  it('rejects non-admin with FORBIDDEN when importing into an existing group', async () => {
    const caller = groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-1' },
        user: {
          id: 'acct-member',
          email: 'bob@example.com',
          emailVerified: true,
          name: 'Bob',
        },
      },
    } as never)

    // loadGroupContext queries
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      name: 'Trip',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'ledger-1',
      ledger: { id: 'ledger-1', currency: '€', currencyCode: 'EUR' },
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      id: 'gm-1',
      groupId: 'grp-1',
      accountId: 'acct-member',
      role: 'MEMBER',
      status: 'ACTIVE',
      ledgerParticipant: { id: 'lp-1', ledgerId: 'ledger-1' },
    } as never)

    await expect(
      caller.import({
        targetGroupId: 'grp-1',
        participants: [...baseParticipants],
        expenses: [],
      }),
    ).rejects.toThrow(/Only admins can import/i)
  })

  it('rejects duplicate source participant names via Zod superRefine', async () => {
    const caller = groupsRouter.createCaller({
      auth: {
        session: { id: 'sess-1' },
        user: {
          id: 'acct-1',
          email: 'alice@example.com',
          emailVerified: true,
          name: 'Alice',
        },
      },
    } as never)

    await expect(
      caller.import({
        groupFormValues: {
          name: 'Imported',
          information: '',
          currency: '€',
          currencyCode: 'EUR',
          participants: [{ name: 'Owner' }],
        },
        participants: [
          {
            mode: 'UNLINKED_PARTICIPANT',
            sourceName: 'John',
            destLedgerParticipantId: 'lp-1',
          },
          {
            mode: 'UNLINKED_PARTICIPANT',
            sourceName: 'john',
            destLedgerParticipantId: 'lp-2',
          },
        ],
        expenses: [],
      }),
    ).rejects.toThrow(/Duplicate source participant name/i)
  })
})

describe('linkUnlinkedParticipantToAccount', () => {
  function stubGroupLedger() {
    // The post-link activity row needs the group's ledgerId.
    // Default the lookup so logActivity does not throw.
    prismaMock.group.findUnique.mockImplementation(async () => {
      return {
        id: 'grp-1',
        ledgerId: 'ledger-1',
      } as never
    })
  }

  it('rejects when the participant is not unlinked', async () => {
    await authAs('acct-admin')
    stubGroupLedger()
    await authAs('acct-admin')
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-1',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'ACCOUNT_MEMBER',
      displayName: null,
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)
    await expect(
      linkUnlinkedParticipantToAccount({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-1',
        accountId: 'acct-other',
        actor: { accountId: 'acct-admin' },
      }),
    ).rejects.toThrow(/not unlinked/i)
  })

  it('rejects when the participant belongs to a different group', async () => {
    await authAs('acct-admin')
    stubGroupLedger()
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-1',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-other' } },
    } as never)
    await expect(
      linkUnlinkedParticipantToAccount({
        groupId: 'grp-1',
        ledgerParticipantId: 'lp-1',
        accountId: 'acct-other',
        actor: { accountId: 'acct-admin' },
      }),
    ).rejects.toThrow(/does not belong/i)
  })

  it('creates a new GroupMember when the account is not yet a member', async () => {
    await authAs('acct-admin')
    stubGroupLedger()
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-1',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-other',
      email: 'b@example.com',
      emailVerified: true,
      name: 'Jane',
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue(null as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'gm-new',
      groupId: 'grp-1',
      accountId: 'acct-other',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({} as never)

    const result = await linkUnlinkedParticipantToAccount({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-1',
      accountId: 'acct-other',
      actor: { accountId: 'acct-admin' },
    })
    expect(result.groupMemberId).toBe('gm-new')
    expect(result.ledgerParticipantId).toBe('lp-1')
  })

  it('reactivates a previously-removed member', async () => {
    await authAs('acct-admin')
    stubGroupLedger()
    prismaMock.ledgerParticipant.findUnique.mockResolvedValue({
      id: 'lp-1',
      ledgerId: 'ledger-1',
      groupMemberId: null,
      kind: 'UNLINKED_PARTICIPANT',
      displayName: 'Jane',
      ledger: { id: 'ledger-1', group: { id: 'grp-1' } },
    } as never)
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'acct-other',
      email: 'b@example.com',
      emailVerified: true,
      name: 'Jane',
    } as never)
    prismaMock.groupMember.findUnique.mockResolvedValue({
      id: 'gm-existing',
      groupId: 'grp-1',
      accountId: 'acct-other',
      role: 'MEMBER',
      status: 'REMOVED',
      leftAt: new Date(),
    } as never)
    prismaMock.groupMember.update.mockResolvedValue({
      id: 'gm-existing',
      groupId: 'grp-1',
      accountId: 'acct-other',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.update.mockResolvedValue({} as never)

    const result = await linkUnlinkedParticipantToAccount({
      groupId: 'grp-1',
      ledgerParticipantId: 'lp-1',
      accountId: 'acct-other',
      actor: { accountId: 'acct-admin' },
    })
    expect(result.groupMemberId).toBe('gm-existing')
  })
})

describe('listUnlinkedParticipants', () => {
  it('returns unlinked participants for a group', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: 'ledger-1',
    } as never)
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      { id: 'lp-1', displayName: 'Jane' },
      { id: 'lp-2', displayName: 'Cleo' },
    ] as never)
    const result = await listUnlinkedParticipants('grp-1')
    expect(result).toEqual([
      { id: 'lp-1', displayName: 'Jane' },
      { id: 'lp-2', displayName: 'Cleo' },
    ])
  })

  it('returns [] when the group has no ledger', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: 'grp-1',
      ledgerId: null,
    } as never)
    const result = await listUnlinkedParticipants('grp-1')
    expect(result).toEqual([])
  })
})

describe('importGroup — LINK_EXISTING_PARTICIPANT', () => {
  async function setupExistingGroupWithLp() {
    await authAs('acct-importer')
    stubGroupWithLedger('dest-grp', 'dest-ledger')
    prismaMock.ledger.create.mockResolvedValue({
      id: 'dest-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'dest-grp',
      name: 'Existing',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'dest-ledger',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({
      id: 'gm-admin',
      groupId: 'dest-grp',
      accountId: 'acct-importer',
      role: 'ADMIN',
      status: 'ACTIVE',
    } as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    prismaMock.expense.create.mockResolvedValue({} as never)
    // Ledger has two existing participants: 'existing-lp-1' (an active
    // member) and 'pending-lp-2' (a pending invitee).
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([
      { id: 'existing-lp-1' },
      { id: 'pending-lp-2' },
    ] as never)
  }

  it('imports onto an existing destination LedgerParticipant without creating a new row', async () => {
    await setupExistingGroupWithLp()
    const result = await importGroup(
      {
        targetGroupId: 'dest-grp',
        participants: [
          {
            mode: 'LINK_ACCOUNT',
            sourceName: 'John',
            linkedAccountId: 'acct-importer',
            destLedgerParticipantId: 'fresh-lp-importer',
          },
          {
            mode: 'LINK_EXISTING_PARTICIPANT',
            sourceName: 'Jane',
            destLedgerParticipantId: 'existing-lp-1',
          },
          {
            mode: 'LINK_EXISTING_PARTICIPANT',
            sourceName: 'carol@example.com',
            destLedgerParticipantId: 'pending-lp-2',
          },
        ],
        expenses: [
          {
            ...baseExpense,
            paidByList: [{ participant: 'fresh-lp-importer', shares: 23000 }],
            paidFor: [
              { participant: 'fresh-lp-importer', shares: 500 },
              { participant: 'existing-lp-1', shares: 500 },
            ],
          } as never,
        ],
        sourceMeta: {
          provider: 'SPLIIT',
          sourceGroupId: 'src-grp',
        },
      },
      { accountId: 'acct-importer' },
    )
    expect(result.groupId).toBe('dest-grp')
    // Only the importer's LINK_ACCOUNT path creates a new
    // LedgerParticipant row. The two LINK_EXISTING_PARTICIPANT
    // mappings reuse the destination ids verbatim.
    expect(prismaMock.ledgerParticipant.create).toHaveBeenCalledTimes(1)
    const createCalls = (
      prismaMock.ledgerParticipant.create.mock.calls as Array<[unknown]>
    ).map(([arg]) => (arg as { data: { id: string } }).data.id)
    expect(createCalls).toEqual(['fresh-lp-importer'])
  })

  it('rejects when the supplied destination LedgerParticipant does not exist in the target group', async () => {
    await setupExistingGroupWithLp()
    await expect(
      importGroup(
        {
          targetGroupId: 'dest-grp',
          participants: [
            {
              mode: 'LINK_ACCOUNT',
              sourceName: 'John',
              linkedAccountId: 'acct-importer',
              destLedgerParticipantId: 'fresh-lp-importer',
            },
            {
              mode: 'LINK_EXISTING_PARTICIPANT',
              sourceName: 'Jane',
              // not in the mocked ledgerParticipant.findMany result
              destLedgerParticipantId: 'ghost-lp',
            },
          ],
          expenses: [],
          sourceMeta: {
            provider: 'SPLIIT',
            sourceGroupId: 'src-grp',
          },
        },
        { accountId: 'acct-importer' },
      ),
    ).rejects.toThrow(/ghost-lp.*not found/i)
  })

  it('rejects LINK_EXISTING_PARTICIPANT when creating a new group (defensive check)', async () => {
    await authAs('acct-importer')
    prismaMock.ledger.create.mockResolvedValue({
      id: 'new-ledger',
      currency: '€',
      currencyCode: 'EUR',
      createdAt: new Date(),
    } as never)
    prismaMock.group.create.mockResolvedValue({
      id: 'new-grp',
      name: 'New',
      information: null,
      archived: false,
      createdAt: new Date(),
      ledgerId: 'new-ledger',
    } as never)
    prismaMock.groupMember.create.mockResolvedValue({} as never)
    prismaMock.ledgerParticipant.create.mockResolvedValue({} as never)
    prismaMock.expense.create.mockResolvedValue({} as never)
    // No findMany call is needed for new groups; the destination
    // ledger starts empty.
    prismaMock.ledgerParticipant.findMany.mockResolvedValue([] as never)

    await expect(
      importGroup(
        {
          groupFormValues: {
            name: 'New',
            information: '',
            currency: '€',
            currencyCode: 'EUR',
            participants: [{ name: 'Owner' }],
          },
          participants: [
            {
              mode: 'LINK_ACCOUNT',
              sourceName: 'John',
              linkedAccountId: 'acct-importer',
              destLedgerParticipantId: 'fresh-lp-importer',
            },
            {
              mode: 'LINK_EXISTING_PARTICIPANT',
              sourceName: 'Jane',
              destLedgerParticipantId: 'some-existing-lp',
            },
          ],
          expenses: [],
        },
        { accountId: 'acct-importer' },
      ),
    ).rejects.toThrow(/creating a new group/i)
  })
})
